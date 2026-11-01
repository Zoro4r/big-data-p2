FROM python:3.11-slim

WORKDIR /app/api
COPY api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# El código (api/, src/ y db/) se monta como volumen (ver docker-compose.yml).
ENV PYTHONPATH=/app/src:/app/api
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
