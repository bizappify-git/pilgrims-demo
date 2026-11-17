FROM python:3.12-alpine
WORKDIR /app
COPY index.html server.py ./
COPY css/ ./css/
COPY js/ ./js/
RUN mkdir -p logs assets
EXPOSE 8000
CMD ["python", "-u", "server.py"]
