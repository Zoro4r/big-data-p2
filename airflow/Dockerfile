FROM apache/airflow:2.10.5-python3.11

# Las restricciones oficiales de Airflow fijan versiones compatibles de cada dependencia.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir "apache-airflow==2.10.5" -r /tmp/requirements.txt \
    --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-2.10.5/constraints-3.11.txt"

# El código del pipeline se monta en /opt/airflow/src (ver docker-compose.yml).
ENV PYTHONPATH=/opt/airflow/src
