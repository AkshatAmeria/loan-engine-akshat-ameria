# 🚀 Loan Eligibility Engine — End-to-End Serverless Workflow

This project implements a **fully automated loan-eligibility computation engine** using AWS Lambda, S3, RDS (PostgreSQL), API Gateway, Serverless Framework, n8n Workflows, Docker Compose, and ngrok.

The engine takes user data uploaded via a CSV, enriches it using scraped bank loan products, computes eligibility, and sends automated emails to users.

---

## 📂 Folder Structure

```
loan-engine-clickpe/
│
├── backend/
│   ├── src/
│   │   ├── getUploadUrl.js
│   │   ├── processCsv.js
│   ├── .env
│   ├── package.json
│   ├── serverless.yml
│   ├── docker-compose.yml
│
├── frontend/
│   ├── index.html
│
├── n8n-workflows/
│   ├── loan-engine workflow A.json
│   ├── loan-engine workflow B.json
│   ├── Workflow C.json
│
├── diagrams/
│
└── README.md
```

---

## 🌐 System Architecture Overview

```
Frontend → API Gateway → Lambda (getUploadUrl)
                   ↓
                S3 Upload
                   ↓ (trigger)
           Lambda (processCsv)
                   ↓
                PostgreSQL RDS
                   ↓
             n8n Workflow B
         (Eligibility evaluation & insert in matches)
                   ↓
             n8n Workflow C
            (Email automation using aws ses)
```

```
n8n workflow A (Loan product discovery is independent of webhook trigger it runs based on schedule trigger)
```


---

## 🧩 Components Explained

### 1️⃣ **Frontend (index.html)** — CSV Upload UI

A simple static interface where an admin uploads `users.csv`.

**Flow:**
1. Calls API Gateway → `getUploadUrl` Lambda
2. Receives a **presigned S3 upload URL**
3. Performs a direct **PUT upload to S3**

---

### 2️⃣ **Lambda Function: `getUploadUrl.js`**

Generates a **presigned URL** for secure CSV upload to S3.

**Key Features:**
- Signed URL valid for 5 minutes
- Supports CORS for frontend
- Returns JSON:

```json
{
  "uploadUrl": "https://loan-csv-akshat.s3.amazonaws.com/uploads/...signedQuery...",
  "key": "uploads/17651..._users.csv"
}
```

This allows frontend → S3 upload **without exposing AWS credentials.**

---

### 3️⃣ **AWS S3 Bucket — `loan-csv-akshat`**

Stores **uploaded CSV files** in:

```
uploads/<timestamp>_users.csv
```

When a file is uploaded, S3 triggers the `processCsv` Lambda.

---

### 4️⃣ **Lambda Function: `processCsv.js`**

This is the **core ingestion pipeline**.

**Responsibilities:**
- ✔ Reads uploaded CSV from S3
- ✔ Parses rows using `csv-parser`
- ✔ Inserts/Updates users in PostgreSQL RDS
- ✔ Triggers **Workflow B** in n8n via webhook
- ✔ Logs all actions to CloudWatch

**Eligibility Trigger:**

```js
await triggerWebhook(process.env.WEBHOOK_URL)
```

This sends an empty JSON `{}` POST request to Workflow B.

---

### 5️⃣ **PostgreSQL RDS**

Stores:
- Users
- Loan products
- Eligibility status

The Lambda uses:

```
host = DB_HOST
user = DB_USER
password = DB_PASS
database = DB_NAME
```

---

## 🤖 n8n Workflows (Docker + ngrok)

n8n is used to handle:
- Webhooks
- Data transformations
- Matching logic
- Email triggers

It is run locally using Docker Compose.

---

### 🐳 `docker-compose.yml`

```yml
version: '3'
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    ports:
      - "5678:5678"
    volumes:
      - n8n_data:/home/node/.n8n
volumes:
  n8n_data:
```

**Run:**

```bash
docker compose up -d
```

---

### 🌍 ngrok for Tunneling

Because Lambda cannot call localhost, we expose n8n via:

```bash
ngrok http 5678
```

**Example tunnel:**

```
https://5caa3dd437b6.ngrok-free.app → http://localhost:5678
```

This URL becomes your **Workflow B webhook URL**.

---

## ⚙️ n8n Workflow Details

### 🧪 Workflow A — Bank Loan Product Scraper

**Purpose:** Scrapes loan product interest rates daily.

**Nodes:**
1. **Schedule Trigger** — runs every 24 hrs
2. **HTTP Request** — scrapes data from bankbazaar
3. **HTML Extract** — extracts interest rate tables
4. **Code Node** — cleans and structures data
5. **SQL Node** — Inserts rows into `loan_products` table

**Outcome:** Latest loan product info stored in RDS.

---

### 🧮 Workflow B — Eligibility Engine

Triggered automatically after `processCsv` Lambda finishes.

**Steps:**
1. **Webhook Trigger**
2. **Fetch Users** (SQL)
3. **Fetch Loan Products** (SQL)
4. **Merge Node**
5. **JS Code Node** — compute eligibility
6. **Split Output:**
   - Eligible Users → Path 1
   - Borderline Users → Path 2
7. **SQL Insert** into `matches` table
8. **Send to Workflow C via HTTP Request**

---

### 📧 Workflow C — Email Dispatcher

Receives data from Workflow B.

**Steps:**
1. **Webhook Trigger**
2. **SQL Lookup**
3. **AWS SES Email Node** — sends emails

**Email templates include:**
- Eligible → Congratulations email
- Borderline → Request for documents email

---

## ☁️ Serverless Deployment Configuration (`serverless.yml`)

```yml
service: loan-eligibility-engine
frameworkVersion: "3"
useDotenv: true

provider:
  name: aws
  runtime: nodejs20.x
  region: us-east-1

  environment:
    BUCKET_NAME: ${env:BUCKET_NAME}
    DB_HOST: ${env:DB_HOST}
    DB_USER: ${env:DB_USER}
    DB_PASS: ${env:DB_PASS}
    DB_NAME: ${env:DB_NAME}
    WEBHOOK_URL: ${env:WEBHOOK_URL}

  iamRoleStatements:
    - Effect: Allow
      Action:
        - s3:GetObject
        - s3:PutObject
        - s3:ListBucket
      Resource:
        - arn:aws:s3:::${env:BUCKET_NAME}
        - arn:aws:s3:::${env:BUCKET_NAME}/*

functions:
  getUploadUrl:
    handler: getUploadUrl.getUploadUrl
    events:
      - http:
          path: get-upload-url
          method: get
          cors: true

  processCsv:
    handler: processCsv.handler
    timeout: 900
    events:
      - s3:
          bucket: ${env:BUCKET_NAME}
          event: s3:ObjectCreated:Put
          rules:
            - prefix: uploads/
          existing: true
```

**Deploy command:**

```bash
serverless deploy
```

---

## 🖥️ How the System Works (End-to-End)

1. User uploads `users.csv` from frontend
2. Frontend gets presigned URL → uploads to S3
3. S3 triggers `processCsv` Lambda
4. Lambda parses CSV → inserts users → triggers Workflow B
5. Workflow B computes eligibility → updates DB → sends results to Workflow C
6. Workflow C emails the user via SES

Everything is **automatized and serverless**.

---

## 🎯 Final Deliverables in This Project

- ✔ Fully working Frontend CSV uploader
- ✔ Two Lambda functions
- ✔ n8n workflow templates (A, B, C)
- ✔ Serverless.yml for deployment
- ✔ Docker-compose for n8n
- ✔ ngrok usage for webhook tunneling
- ✔ Full end-to-end eligibility pipeline
- ✔ Screenshots included in `/diagrams`
- ✔ This complete README

---

## 🏁 Conclusion

This project demonstrates:
- Serverless architecture
- Event-driven workflows
- Real-time data processing
- n8n automation
- Email communication pipelines
- Secure S3-presigned uploads
- Scalable eligibility engine

---

## 📝 Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd loan-engine-clickpe
   ```

2. **Install dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the `backend/` directory:
   ```
   BUCKET_NAME=loan-csv-akshat
   DB_HOST=your-rds-endpoint
   DB_USER=your-db-user
   DB_PASS=your-db-password
   DB_NAME=your-db-name
   WEBHOOK_URL=your-ngrok-url/webhook
   ```

4. **Start n8n with Docker**
   ```bash
   docker compose up -d
   ```

5. **Start ngrok tunnel**
   ```bash
   ngrok http 5678
   ```

6. **Import n8n workflows**
   - Access n8n at `http://localhost:5678`
   - Import the three workflow JSON files from `n8n-workflows/`

7. **Deploy to AWS**
   ```bash
   serverless deploy
   ```

8. **Open frontend**
   - Open `frontend/index.html` in a browser
   - Update the API Gateway URL in the HTML file
   - Do open the html file in live server

---

## 📧 Contact
For questions or issues, please open an issue in the repository or connect at 120104.akshat@gmai.com

Happy Automating !!