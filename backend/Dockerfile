FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

# Install Tesseract OCR for document processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Set up user with UID 1000 for Hugging Face Spaces security
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

# Copy requirements and install dependencies
COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source and assets
COPY --chown=user:user . .

# Ensure uploads directory exists and has write permissions
RUN mkdir -p uploads && chown -R user:user /home/user/app

# Switch to non-root user (Hugging Face standard)
USER user

# Cloud configuration (Hugging Face Spaces default port is 7860)
ENV PORT=7860
ENV BROWSER_HEADLESS=true
ENV PYTHONUNBUFFERED=1

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
