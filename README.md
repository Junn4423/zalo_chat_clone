# Chat project

This repository contains the MobileChat React Native client and the Node.js chat backend.

## Mobile client

```powershell
cd MobileChat
npm ci
```

For Android release builds, configure signing values in `android/keystore.properties` locally. Keep signing keys and credentials out of version control.

## Backend

```powershell
cd Chat_Backend
npm ci
Copy-Item .env.example .env
```

Set local database credentials and service URLs in `.env`, then start with `npm start`.
