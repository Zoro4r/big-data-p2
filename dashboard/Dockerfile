FROM python:3.11-slim

WORKDIR /app
COPY dashboard/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# El código del pipeline (src/) y del dashboard se montan como volúmenes (ver docker-compose.yml).
ENV PYTHONPATH=/app/src:/app/dashboard
EXPOSE 8501
CMD ["streamlit", "run", "/app/dashboard/app.py", "--server.port=8501", "--server.address=0.0.0.0", \
     "--server.headless=true", "--browser.gatherUsageStats=false", "--client.toolbarMode=viewer", \
     "--theme.base=light", "--theme.primaryColor=#2a78d6", "--theme.backgroundColor=#f6f7f9", \
     "--theme.secondaryBackgroundColor=#eef2f6", "--theme.textColor=#0f172a"]
