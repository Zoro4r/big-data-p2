# Infraestructura del proyecto en GCP.
# Una VM de Compute Engine corre el mismo docker-compose que en local (MongoDB, Cassandra, Neo4j,
# Postgres y Airflow). Un bucket de Cloud Storage guarda el código desplegado y el respaldo de
# los datos crudos (data lake). Se crea y se destruye con ./deploy.sh y ./destroy.sh.

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# --- APIs necesarias -----------------------------------------------------------------------

resource "google_project_service" "apis" {
  for_each           = toset(["compute.googleapis.com", "storage.googleapis.com", "iap.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}

# --- Contraseñas (las genera Terraform; se leen con `terraform output`) ----------------------

resource "random_password" "mongo" {
  length  = 24
  special = false
}

resource "random_password" "neo4j" {
  length  = 24
  special = false
}

resource "random_password" "airflow_admin" {
  length  = 16
  special = false
}

resource "random_password" "dashboard" {
  length  = 16
  special = false
}

resource "random_password" "airflow_db" {
  length  = 24
  special = false
}

# --- Cloud Storage: código desplegado y respaldo de datos crudos -----------------------------

resource "google_storage_bucket" "data" {
  name                        = "${var.project_id}-wikipipe"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
  depends_on                  = [google_project_service.apis]
}

resource "google_storage_bucket_object" "code" {
  name   = "code/app.tar.gz"
  bucket = google_storage_bucket.data.name
  source = var.code_archive
}

# --- Cuenta de servicio de la VM ---------------------------------------------------------------

resource "google_service_account" "vm" {
  account_id   = "wikipipe-vm"
  display_name = "VM del pipeline de Wikipedia"
  depends_on   = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "vm_bucket" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_project_iam_member" "vm_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.vm.email}"
}

# --- Red: IP fija y reglas de firewall -------------------------------------------------------

resource "google_compute_address" "vm" {
  name       = "wikipipe-ip"
  region     = var.region
  depends_on = [google_project_service.apis]
}

# Interfaces de administración (Airflow, Neo4j Browser y su conexión bolt) solo desde las IPs permitidas.
# MongoDB (27017) y Cassandra (9042) no se exponen a internet.
resource "google_compute_firewall" "web" {
  name          = "wikipipe-web"
  network       = "default"
  source_ranges = var.allowed_cidrs
  target_tags   = ["wikipipe"]
  allow {
    protocol = "tcp"
    ports    = ["8080", "7474", "7687"]
  }
  depends_on = [google_project_service.apis]
}

# Dashboard: abierto para compartirlo con el equipo (por defecto, a cualquier IP). Lo protege la
# contraseña DASHBOARD_PASSWORD que genera Terraform.
resource "google_compute_firewall" "dashboard" {
  name          = "wikipipe-dashboard"
  network       = "default"
  source_ranges = var.dashboard_cidrs
  target_tags   = ["wikipipe"]
  allow {
    protocol = "tcp"
    ports    = ["8501"]
  }
  depends_on = [google_project_service.apis]
}

# SSH solo a través de Identity-Aware Proxy (rango fijo de Google), sin abrir el puerto 22 a internet.
resource "google_compute_firewall" "ssh_iap" {
  name          = "wikipipe-ssh-iap"
  network       = "default"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["wikipipe"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
  depends_on = [google_project_service.apis]
}

# --- VM ----------------------------------------------------------------------------------------

locals {
  env_file = <<-EOT
    WIKIS=${var.wikis}
    WIKI_USER_AGENT=${var.wiki_user_agent}
    MONGO_USER=admin
    MONGO_PASSWORD=${random_password.mongo.result}
    NEO4J_PASSWORD=${random_password.neo4j.result}
    AIRFLOW_ADMIN_USER=admin
    AIRFLOW_ADMIN_PASSWORD=${random_password.airflow_admin.result}
    AIRFLOW_DB_PASSWORD=${random_password.airflow_db.result}
    AIRFLOW_UID=50000
    DAGS_PAUSED=false
    DASHBOARD_PASSWORD=${random_password.dashboard.result}
    NEO4J_HEAP=${var.neo4j_heap}
    NEO4J_PAGECACHE=${var.neo4j_pagecache}
  EOT
}

resource "google_compute_instance" "vm" {
  name                      = "wikipipe-vm"
  machine_type              = var.machine_type
  zone                      = var.zone
  tags                      = ["wikipipe"]
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.vm.address
    }
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    startup-script = templatefile("${path.module}/startup.sh", { bucket = google_storage_bucket.data.name })
    wikipipe-env   = local.env_file
    # Cambia con cada versión del código; deploy.sh vuelve a correr el startup script.
    code-md5 = google_storage_bucket_object.code.md5hash
  }

  depends_on = [google_storage_bucket_object.code, google_storage_bucket_iam_member.vm_bucket]

  # El disco se puede ampliar en caliente con gcloud; cambiar el tamaño aquí recrearía la VM y
  # borraría los datos, así que Terraform solo lo usa al crearla.
  lifecycle {
    ignore_changes = [boot_disk[0].initialize_params[0].size]
  }
}
