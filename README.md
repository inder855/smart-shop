# Smart Shop - Admin Dashboard

A Node.js shopping project with admin authentication and dashboard.

## Features
- Admin login system with secure password hashing
- SQLite database for data storage
- Session-based authentication
- Responsive admin dashboard
- Beautiful UI with gradient design

## Installation
```bash
npm install
```

## Usage
Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Admin Credentials
- **Email:** shop@gmail.com
- **Password:** 123456

## Access
- Login Page: http://localhost:3000/login
- Dashboard: http://localhost:3000/dashboard

## Project Structure
```
smart-shop/
├── server.js           # Main server file
├── package.json        # Dependencies
├── views/              # EJS templates
│   ├── login.ejs       # Login page
│   └── dashboard.ejs   # Admin dashboard
├── public/             # Static files
└── smart-shop.db       # SQLite database (auto-created)
```

## Technologies Used
- Node.js
- Express.js
- SQLite3
- EJS (templating)
- bcrypt (password hashing)
- express-session (session management)
