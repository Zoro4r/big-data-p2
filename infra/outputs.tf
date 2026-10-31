output "vm_ip" {
  value = google_compute_address.vm.address
}

output "airflow_url" {
  value = "http://${google_compute_address.vm.address}:8080"
}

output "neo4j_url" {
  value = "http://${google_compute_address.vm.address}:7474"
}

output "dashboard_url" {
  value = "http://${google_compute_address.vm.address}:8501"
}

output "dashboard_password" {
  value     = random_password.dashboard.result
  sensitive = true
}

output "bucket" {
  value = google_storage_bucket.data.name
}

output "airflow_admin_password" {
  value     = random_password.airflow_admin.result
  sensitive = true
}

output "neo4j_password" {
  value     = random_password.neo4j.result
  sensitive = true
}

output "mongo_password" {
  value     = random_password.mongo.result
  sensitive = true
}
