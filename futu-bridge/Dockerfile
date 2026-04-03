FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV FUTU_HOST=192.168.31.18
ENV FUTU_PORT=11112
ENV BRIDGE_PORT=8765

EXPOSE 8765

CMD ["python", "main.py"]
