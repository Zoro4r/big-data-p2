# Despliegue en GCP

Instrucciones para desplegar el proyecto completo en tu propia cuenta de Google Cloud con un solo comando. Al terminar tendrás una VM que corre el pipeline cada hora, con MongoDB, Cassandra, Neo4j y Airflow.

## Qué se crea

| Recurso | Detalle | Costo aproximado |
| --- | --- | --- |
| VM `wikipipe-vm` | e2-standard-2 (2 vCPU, 8 GB), Debian 12, disco de 50 GB, us-central1-a | ~1.6 USD/día |
| IP fija `wikipipe-ip` | Dirección pública de la VM | ~0.12 USD/día |
| Bucket `<PROJECT_ID>-wikipipe` | Código desplegado y respaldo de los datos crudos cada 30 min | centavos |
| Firewall | Airflow (8080), Neo4j (7474 y 7687) y dashboard (8501) solo desde tu IP; SSH solo por IAP | gratis |
| Cuenta de servicio `wikipipe-vm` | Permisos de la VM sobre el bucket y los logs | gratis |

MongoDB y Cassandra no quedan expuestas a internet. Las contraseñas las genera Terraform.

## Requisitos (una sola vez)

1. **Cuenta de GCP con facturación activa** (sirve el crédito de prueba).
2. **Google Cloud CLI** (`gcloud`): https://cloud.google.com/sdk/docs/install
3. **Terraform 1.6 o superior**: https://developer.hashicorp.com/terraform/install
   - En macOS, si Homebrew falla, descarga el binario de https://releases.hashicorp.com/terraform/ y cópialo a una carpeta de tu `PATH`.
4. **Acceso al repositorio**:

```bash
git clone https://github.com/Zoro4r/big-data-p2.git
cd big-data-p2
```

## Pasos

### 1. Crear tu proyecto de GCP

El ID de un proyecto es único en todo GCP, así que usa uno propio (por ejemplo `big-data-p2-juan`). El nombre visible puede ser el mismo.

```bash
gcloud auth login
export PROJECT_ID=big-data-p2-<tu-nombre>

gcloud projects create $PROJECT_ID --name="big-data-p2"
gcloud billing accounts list                         # copia tu ACCOUNT_ID
gcloud billing projects link $PROJECT_ID --billing-account <ACCOUNT_ID>
gcloud config set project $PROJECT_ID
```

### 2. Dar credenciales a Terraform

Abre el navegador para iniciar sesión:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project $PROJECT_ID
```

### 3. Desplegar

```bash
./deploy.sh
```

Tarda unos 3 minutos en crear la infraestructura. La primera vez, la VM tarda otros ~5 minutos en instalar Docker y levantar los contenedores. Al final verás las URLs y contraseñas:

```
==> Despliegue listo.
    Airflow : http://<IP>:8080   usuario admin / <contraseña>
    Neo4j   : http://<IP>:7474   usuario neo4j / <contraseña>
    Dashboard: http://<IP>:8501  contraseña <contraseña>
```

Para ver de nuevo las contraseñas:

```bash
terraform -chdir=infra output -raw airflow_admin_password
terraform -chdir=infra output -raw neo4j_password
terraform -chdir=infra output -raw dashboard_password
```

### 4. Cerrar las reglas de firewall por defecto (recomendado)

GCP crea en todo proyecto nuevo dos reglas que abren SSH (22) y RDP (3389) a todo internet. El despliegue no las necesita: el SSH va por IAP, que tiene su propia regla.

```bash
gcloud compute firewall-rules delete default-allow-ssh default-allow-rdp --quiet
```

### 5. Verificar

```bash
# Ver el arranque de la VM
gcloud compute instances get-serial-port-output wikipipe-vm --zone us-central1-a | grep startup-script

# Entrar a la VM (por IAP) y ver los contenedores y las ejecuciones del DAG
gcloud compute ssh wikipipe-vm --zone us-central1-a --tunnel-through-iap
cd /opt/wikipipe
sudo docker compose ps
sudo docker compose exec airflow airflow dags list-runs -d wikipedia_recent_changes
```

En la VM, el DAG `wikipedia_recent_changes` arranca activo y procesa la hora anterior cada hora.

## Actualizar el código

Haz commit de tus cambios y vuelve a ejecutar:

```bash
./deploy.sh
```

Sube la versión commiteada y la aplica en la VM sin recrearla: los datos de las bases se conservan.

## Opciones

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `ALLOWED_CIDR` | tu IP pública `/32` | Quién puede abrir Airflow, Neo4j y el dashboard. Si cambia tu IP, vuelve a ejecutar `./deploy.sh` |
| `MACHINE_TYPE` | `e2-standard-2` | Tamaño de la VM |
| `REGION` / `ZONE` | `us-central1` / `us-central1-a` | Ubicación |

Ejemplo: `ALLOWED_CIDR=0.0.0.0/0 ./deploy.sh` abre las interfaces web a cualquier IP. Úsalo solo para la demo, porque quedan protegidas únicamente por contraseña.

## Borrar todo

Al terminar el curso, para no gastar créditos:

```bash
./destroy.sh
```

Pide escribir el ID del proyecto para confirmar. Borra la VM, el disco, la IP, el firewall y el bucket con sus datos. El proyecto de GCP no se borra.

## Problemas comunes

| Síntoma | Causa y solución |
| --- | --- |
| `Terraform necesita credenciales` | Falta el paso 2 (`gcloud auth application-default login`) |
| Error de facturación o `billing account` | El proyecto no tiene una cuenta de facturación vinculada (paso 1) |
| La URL de Airflow no carga | La VM sigue arrancando (espera 5 min) o cambió tu IP (vuelve a ejecutar `./deploy.sh`) |
| `gcloud compute ssh` pide crear una clave SSH | Es normal la primera vez; acepta |
