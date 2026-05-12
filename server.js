require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'smart-shop-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 } // 24 hours
}));
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/products/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// Database setup
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smart_shop',
    port: process.env.DB_PORT || 3306
};

let db;

async function initializeDatabase() {
    try {
        // First connect without database to create it
        const tempConfig = {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306
        };

        const tempDb = await mysql.createConnection(tempConfig);
        console.log('Connected to MySQL server');

        // Create database if not exists
        await tempDb.query('CREATE DATABASE IF NOT EXISTS smart_shop');
        console.log('Database created or already exists');
        await tempDb.end();

        // Now connect to the specific database
        db = await mysql.createConnection(dbConfig);
        console.log('Connected to smart_shop database');

        // Create admin table
        await db.query(`CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('Admins table created or already exists');

        // Create products table
        await db.query(`CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            price DECIMAL(10,2) NOT NULL,
            stock INT DEFAULT 0,
            category VARCHAR(100),
            images TEXT,
            status ENUM('active', 'inactive') DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`);
        console.log('Products table created or already exists');

        // Create customers table
        await db.query(`CREATE TABLE IF NOT EXISTS customers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            phone VARCHAR(20),
            address TEXT,
            city VARCHAR(100),
            state VARCHAR(100),
            pincode VARCHAR(10),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('Customers table created or already exists');

        // Create orders table
        await db.query(`CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            customer_id INT NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            shipping_address TEXT NOT NULL,
            payment_method VARCHAR(50) DEFAULT 'cod',
            payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',
            order_status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        )`);
        console.log('Orders table created or already exists');

        // Create order items table
        await db.query(`CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )`);
        console.log('Order items table created or already exists');

        // Insert dummy admin
        await insertDummyAdmin();
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
}

// Insert dummy admin
async function insertDummyAdmin() {
    const email = 'shop@gmail.com';
    const password = '123456';

    try {
        // Check if admin already exists
        const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);

        if (rows.length === 0) {
            // Hash password and insert
            const hashedPassword = await bcrypt.hash(password, 10);
            await db.query('INSERT INTO admins (email, password) VALUES (?, ?)', 
                [email, hashedPassword]
            );
            console.log('Dummy admin created successfully');
            console.log('Email: shop@gmail.com');
            console.log('Password: 123456');
        } else {
            console.log('Admin already exists');
        }
    } catch (err) {
        console.error('Error inserting dummy admin:', err.message);
    }
}

// Middleware to check if admin is logged in
function requireAuth(req, res, next) {
    if (req.session.adminId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes
app.get('/admin', (req, res) => {
    if (req.session.adminId) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

// Login page
app.get('/login', (req, res) => {
    res.render('admin/login', { error: null });
});

// Login POST
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);

        if (rows.length === 0) {
            return res.render('admin/login', { error: 'Invalid email or password' });
        }

        const admin = rows[0];
        const match = await bcrypt.compare(password, admin.password);

        if (match) {
            req.session.adminId = admin.id;
            req.session.adminEmail = admin.email;
            res.redirect('/dashboard');
        } else {
            res.render('admin/login', { error: 'Invalid email or password' });
        }
    } catch (err) {
        console.error('Error finding admin:', err.message);
        res.render('admin/login', { error: 'Database error' });
    }
});

// Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
    try {
        // Get statistics
        const [products] = await db.query('SELECT COUNT(*) as count FROM products');
        const [orders] = await db.query('SELECT COUNT(*) as count FROM orders');
        const [customers] = await db.query('SELECT COUNT(*) as count FROM customers');
        const [revenue] = await db.query('SELECT SUM(total_amount) as total FROM orders WHERE payment_status = ? AND order_status != ?', ['paid', 'cancelled']);

        // Get recent orders
        const [recentOrders] = await db.query(`
            SELECT o.*, c.name as customer_name 
            FROM orders o 
            JOIN customers c ON o.customer_id = c.id 
            ORDER BY o.created_at DESC 
            LIMIT 5
        `);

        // Get recent products
        const [recentProducts] = await db.query(`
            SELECT * FROM products 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        res.render('admin/dashboard', {
            adminEmail: req.session.adminEmail,
            stats: {
                totalProducts: products[0].count || 0,
                totalOrders: orders[0].count || 0,
                totalCustomers: customers[0].count || 0,
                totalRevenue: revenue[0].total || 0
            },
            recentOrders,
            recentProducts
        });
    } catch (err) {
        console.error('Error fetching dashboard data:', err.message);
        res.render('admin/dashboard', {
            adminEmail: req.session.adminEmail,
            stats: {
                totalProducts: 0,
                totalOrders: 0,
                totalCustomers: 0,
                totalRevenue: 0
            },
            recentOrders: [],
            recentProducts: []
        });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err.message);
        }
        res.redirect('/login');
    });
});

// Frontend Routes

// Home page
app.get('/', async (req, res) => {
    try {
        const [featuredProducts] = await db.query('SELECT * FROM products WHERE status = "active" ORDER BY created_at DESC LIMIT 8');
        res.render('frontend/home', {
            featuredProducts,
            customerName: req.session.customerName || null,
            customerEmail: req.session.customerEmail || null
        });
    } catch (err) {
        console.error('Error fetching featured products:', err.message);
        res.render('frontend/home', {
            featuredProducts: [],
            customerName: req.session.customerName || null,
            customerEmail: req.session.customerEmail || null
        });
    }
});

// Frontend products listing
app.get('/shop', async (req, res) => {
    try {
        const category = req.query.category;
        let query = 'SELECT * FROM products WHERE status = "active"';
        let params = [];

        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }

        query += ' ORDER BY created_at DESC';

        const [products] = await db.query(query, params);
        res.render('frontend/products', {
            products,
            category: category || null,
            customerName: req.session.customerName || null,
            customerEmail: req.session.customerEmail || null
        });
    } catch (err) {
        console.error('Error fetching products:', err.message);
        res.render('frontend/products', {
            products: [],
            category: req.query.category || null,
            customerName: req.session.customerName || null,
            customerEmail: req.session.customerEmail || null
        });
    }
});

// Product detail
app.get('/product/:id', async (req, res) => {
    try {
        const [products] = await db.query('SELECT * FROM products WHERE id = ? AND status = "active"', [req.params.id]);
        if (products.length === 0) {
            return res.redirect('/shop');
        }
        res.render('frontend/product-detail', {
            product: products[0],
            customerName: req.session.customerName || null,
            customerEmail: req.session.customerEmail || null
        });
    } catch (err) {
        console.error('Error fetching product:', err.message);
        res.redirect('/shop');
    }
});

// Cart page
app.get('/cart', (req, res) => {
    const cart = JSON.parse(req.session.cart || '[]');
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal > 500 ? 0 : 50;
    const tax = subtotal * 0.18;
    const total = subtotal + shipping + tax;

    res.render('frontend/cart', {
        cart,
        subtotal,
        shipping,
        tax,
        total,
        customerName: req.session.customerName || null,
        customerEmail: req.session.customerEmail || null
    });
});

// Add to cart
app.post('/cart/add', (req, res) => {
    const { id, name, price, image, quantity } = req.body;
    const cart = JSON.parse(req.session.cart || '[]');
    
    const existingItem = cart.find(item => item.id === id);
    if (existingItem) {
        existingItem.quantity += parseInt(quantity) || 1;
    } else {
        cart.push({
            id,
            name,
            price: parseFloat(price),
            image,
            quantity: parseInt(quantity) || 1
        });
    }
    
    req.session.cart = JSON.stringify(cart);
    res.json({ success: true, count: cart.reduce((sum, item) => sum + item.quantity, 0) });
});

// Update cart
app.post('/cart/update', (req, res) => {
    const { id, quantity } = req.body;
    const cart = JSON.parse(req.session.cart || '[]');
    
    const item = cart.find(item => item.id === id);
    if (item) {
        item.quantity = parseInt(quantity);
        if (item.quantity <= 0) {
            const index = cart.indexOf(item);
            cart.splice(index, 1);
        }
    }
    
    req.session.cart = JSON.stringify(cart);
    res.json({ success: true });
});

// Remove from cart
app.post('/cart/remove', (req, res) => {
    const { id } = req.body;
    const cart = JSON.parse(req.session.cart || '[]');
    
    const index = cart.findIndex(item => item.id === id);
    if (index > -1) {
        cart.splice(index, 1);
    }
    
    req.session.cart = JSON.stringify(cart);
    res.json({ success: true });
});

// Cart count
app.get('/cart/count', (req, res) => {
    const cart = JSON.parse(req.session.cart || '[]');
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    res.json({ count });
});

// About page
app.get('/about', (req, res) => {
    res.render('frontend/about', {
        customerName: req.session.customerName || null,
        customerEmail: req.session.customerEmail || null
    });
});

// Categories page
app.get('/categories', (req, res) => {
    res.render('frontend/categories', {
        customerName: req.session.customerName || null,
        customerEmail: req.session.customerEmail || null
    });
});

// Contact page
app.get('/contact', (req, res) => {
    res.render('frontend/contact', {
        customerName: req.session.customerName || null,
        customerEmail: req.session.customerEmail || null
    });
});

// Customer Auth Routes

// Customer login page
app.get('/customer/login', (req, res) => {
    res.render('frontend/login', {
        error: null,
        customerName: req.session.customerName || null,
        customerEmail: req.session.customerEmail || null
    });
});

// Customer login
app.post('/customer/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [rows] = await db.query('SELECT * FROM customers WHERE email = ?', [email]);

        if (rows.length === 0) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const customer = rows[0];
        const match = await bcrypt.compare(password, customer.password);

        if (match) {
            req.session.customerId = customer.id;
            req.session.customerName = customer.name;
            req.session.customerEmail = customer.email;
            res.json({ success: true, message: 'Login successful' });
        } else {
            res.status(400).json({ error: 'Invalid email or password' });
        }
    } catch (err) {
        console.error('Error finding customer:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Customer register page
app.get('/customer/register', (req, res) => {
    res.render('frontend/register', {
        error: null,
        customerName: req.session.customerName || null,
        customerEmail: req.session.customerEmail || null
    });
});

// Customer register
app.post('/customer/register', async (req, res) => {
    const { name, email, password, phone, address, city, state, pincode } = req.body;

    try {
        const [existing] = await db.query('SELECT * FROM customers WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO customers (name, email, password, phone, address, city, state, pincode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, email, hashedPassword, phone, address, city, state, pincode]
        );

        res.json({ success: true, message: 'Account created successfully' });
    } catch (err) {
        console.error('Error creating customer:', err.message);
        res.status(500).json({ error: 'Error creating account' });
    }
});

// Customer logout
app.get('/customer/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err.message);
        }
        res.redirect('/');
    });
});

// Checkout page
app.get('/checkout', async (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }
    
    const cart = JSON.parse(req.session.cart || '[]');
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal > 500 ? 0 : 50;
    const tax = subtotal * 0.18;
    const total = subtotal + shipping + tax;

    // Get customer details
    const [customers] = await db.query('SELECT * FROM customers WHERE id = ?', [req.session.customerId]);
    const customer = customers[0] || {};

    res.render('frontend/checkout', {
        cart,
        subtotal,
        shipping,
        tax,
        total,
        customerName: req.session.customerName,
        customerEmail: req.session.customerEmail,
        customer
    });
});

// Process checkout
app.post('/checkout', async (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }

    const { name, phone, address, city, state, pincode, paymentMethod } = req.body;
    
    // Store checkout data in session
    req.session.checkoutData = {
        name, phone, address, city, state, pincode, paymentMethod
    };

    const cart = JSON.parse(req.session.cart || '[]');
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal > 500 ? 0 : 50;
    const tax = subtotal * 0.18;
    const total = subtotal + shipping + tax;

    res.render('frontend/payment', {
        paymentMethod,
        total,
        customerName: req.session.customerName,
        customerEmail: req.session.customerEmail
    });
});

// Payment page
app.get('/payment', (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }
    
    const cart = JSON.parse(req.session.cart || '[]');
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal > 500 ? 0 : 50;
    const tax = subtotal * 0.18;
    const total = subtotal + shipping + tax;

    res.render('frontend/payment', {
        paymentMethod: req.session.checkoutData?.paymentMethod || 'cod',
        total,
        customerName: req.session.customerName,
        customerEmail: req.session.customerEmail
    });
});

// Process payment
app.post('/payment/process', async (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }

    try {
        const checkoutData = req.session.checkoutData || req.body;
        const cart = JSON.parse(req.session.cart || '[]');
        
        if (cart.length === 0) {
            return res.redirect('/cart');
        }

        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const shipping = subtotal > 500 ? 0 : 50;
        const tax = subtotal * 0.18;
        const total = subtotal + shipping + tax;

        // Create order
        const shippingAddress = `${checkoutData.address}, ${checkoutData.city}, ${checkoutData.state} - ${checkoutData.pincode}`;
        
        const [orderResult] = await db.query(
            'INSERT INTO orders (customer_id, total_amount, shipping_address, payment_method, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?)',
            [req.session.customerId, total, shippingAddress, checkoutData.paymentMethod, 'paid', 'pending']
        );

        const orderId = orderResult.insertId;

        // Create order items
        for (const item of cart) {
            await db.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.id, item.quantity, item.price]
            );
        }

        // Clear cart
        req.session.cart = '[]';
        delete req.session.checkoutData;

        res.render('frontend/order-success', {
            orderId,
            total,
            customerName: req.session.customerName,
            customerEmail: req.session.customerEmail
        });
    } catch (err) {
        console.error('Error processing payment:', err.message);
        res.redirect('/checkout');
    }
});

// My Orders page
app.get('/orders', async (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }

    try {
        const [orders] = await db.query(
            'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC',
            [req.session.customerId]
        );

        // Get items for each order
        for (const order of orders) {
            const [items] = await db.query(
                `SELECT oi.*, p.name, p.images 
                 FROM order_items oi 
                 JOIN products p ON oi.product_id = p.id 
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items.map(item => ({
                ...item,
                image: item.images ? JSON.parse(item.images)[0] : 'https://via.placeholder.com/60'
            }));
        }

        res.render('frontend/orders', {
            orders,
            customerName: req.session.customerName,
            customerEmail: req.session.customerEmail
        });
    } catch (err) {
        console.error('Error fetching orders:', err.message);
        res.render('frontend/orders', {
            orders: [],
            customerName: req.session.customerName,
            customerEmail: req.session.customerEmail
        });
    }
});

// Profile page
app.get('/profile', async (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }

    try {
        const [customers] = await db.query('SELECT * FROM customers WHERE id = ?', [req.session.customerId]);
        const customer = customers[0] || {};

        res.render('frontend/profile', {
            customer,
            customerName: req.session.customerName,
            customerEmail: req.session.customerEmail,
            error: null,
            success: null
        });
    } catch (err) {
        console.error('Error fetching profile:', err.message);
        res.redirect('/');
    }
});

// Update profile
app.post('/profile/update', async (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }

    const { name, phone, address, city, state, pincode, currentPassword, newPassword } = req.body;

    try {
        // Update basic info
        await db.query(
            'UPDATE customers SET name = ?, phone = ?, address = ?, city = ?, state = ?, pincode = ? WHERE id = ?',
            [name, phone, address, city, state, pincode, req.session.customerId]
        );

        // Update session name
        req.session.customerName = name;

        // Handle password change if provided
        if (currentPassword && newPassword) {
            const [customers] = await db.query('SELECT * FROM customers WHERE id = ?', [req.session.customerId]);
            const customer = customers[0];

            const match = await bcrypt.compare(currentPassword, customer.password);
            if (match) {
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                await db.query('UPDATE customers SET password = ? WHERE id = ?', [hashedPassword, req.session.customerId]);
            } else {
                const [customers] = await db.query('SELECT * FROM customers WHERE id = ?', [req.session.customerId]);
                return res.render('frontend/profile', {
                    customer: customers[0],
                    customerName: req.session.customerName,
                    customerEmail: req.session.customerEmail,
                    error: 'Current password is incorrect',
                    success: null
                });
            }
        }

        const [customers] = await db.query('SELECT * FROM customers WHERE id = ?', [req.session.customerId]);
        res.render('frontend/profile', {
            customer: customers[0],
            customerName: req.session.customerName,
            customerEmail: req.session.customerEmail,
            error: null,
            success: 'Profile updated successfully'
        });
    } catch (err) {
        console.error('Error updating profile:', err.message);
        const [customers] = await db.query('SELECT * FROM customers WHERE id = ?', [req.session.customerId]);
        res.render('frontend/profile', {
            customer: customers[0],
            customerName: req.session.customerName,
            customerEmail: req.session.customerEmail,
            error: 'Error updating profile',
            success: null
        });
    }
});

// Cancel order
app.post('/orders/:id/cancel', async (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer/login');
    }

    try {
        const orderId = req.params.id;

        // Check if order belongs to customer and is in pending status
        const [orders] = await db.query(
            'SELECT * FROM orders WHERE id = ? AND customer_id = ? AND order_status = ?',
            [orderId, req.session.customerId, 'pending']
        );

        if (orders.length === 0) {
            return res.redirect('/orders');
        }

        // Update order status to cancelled
        await db.query(
            'UPDATE orders SET order_status = ? WHERE id = ?',
            ['cancelled', orderId]
        );

        res.redirect('/orders');
    } catch (err) {
        console.error('Error cancelling order:', err.message);
        res.redirect('/orders');
    }
});

// Product Routes

// List all products
app.get('/products', requireAuth, async (req, res) => {
    try {
        const [products] = await db.query('SELECT * FROM products ORDER BY created_at DESC');
        res.render('admin/products/list', { 
            products,
            adminEmail: req.session.adminEmail,
            error: null
        });
    } catch (err) {
        console.error('Error fetching products:', err.message);
        res.render('admin/products/list', { 
            products: [],
            adminEmail: req.session.adminEmail,
            error: 'Error fetching products'
        });
    }
});

// Add product form
app.get('/products/add', requireAuth, (req, res) => {
    res.render('admin/products/add', { 
        adminEmail: req.session.adminEmail,
        error: null
    });
});

// Create product
app.post('/products/add', requireAuth, upload.array('images', 5), async (req, res) => {
    try {
        const { name, description, price, stock, category, status } = req.body;
        
        // Validation
        if (!name || !price) {
            return res.render('admin/products/add', {
                adminEmail: req.session.adminEmail,
                error: 'Name and price are required'
            });
        }

        const imagePaths = req.files ? req.files.map(file => '/uploads/products/' + file.filename) : [];
        const imagesJson = JSON.stringify(imagePaths);

        await db.query(
            'INSERT INTO products (name, description, price, stock, category, images, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, description, price, stock || 0, category, imagesJson, status || 'active']
        );

        res.redirect('/products');
    } catch (err) {
        console.error('Error creating product:', err.message);
        res.render('admin/products/add', {
            adminEmail: req.session.adminEmail,
            error: 'Error creating product'
        });
    }
});

// Edit product form
app.get('/products/edit/:id', requireAuth, async (req, res) => {
    try {
        const [products] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
        if (products.length === 0) {
            return res.redirect('/products');
        }
        const product = products[0];
        product.images = product.images ? JSON.parse(product.images) : [];
        res.render('admin/products/edit', { 
            product,
            adminEmail: req.session.adminEmail,
            error: null
        });
    } catch (err) {
        console.error('Error fetching product:', err.message);
        res.redirect('/products');
    }
});

// Update product
app.post('/products/edit/:id', requireAuth, upload.array('images', 5), async (req, res) => {
    try {
        const { name, description, price, stock, category, status, existingImages } = req.body;
        const productId = req.params.id;

        // Validation
        if (!name || !price) {
            const [products] = await db.query('SELECT * FROM products WHERE id = ?', [productId]);
            const product = products[0];
            product.images = product.images ? JSON.parse(product.images) : [];
            return res.render('admin/products/edit', {
                product,
                adminEmail: req.session.adminEmail,
                error: 'Name and price are required'
            });
        }

        // Handle images
        let imagePaths = [];
        if (existingImages) {
            imagePaths = Array.isArray(existingImages) ? existingImages : [existingImages];
        }
        if (req.files && req.files.length > 0) {
            const newImages = req.files.map(file => '/uploads/products/' + file.filename);
            imagePaths = [...imagePaths, ...newImages];
        }
        const imagesJson = JSON.stringify(imagePaths);

        await db.query(
            'UPDATE products SET name = ?, description = ?, price = ?, stock = ?, category = ?, images = ?, status = ? WHERE id = ?',
            [name, description, price, stock || 0, category, imagesJson, status || 'active', productId]
        );

        res.redirect('/products');
    } catch (err) {
        console.error('Error updating product:', err.message);
        res.redirect('/products');
    }
});

// Delete product
app.get('/products/delete/:id', requireAuth, async (req, res) => {
    try {
        await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
        res.redirect('/products');
    } catch (err) {
        console.error('Error deleting product:', err.message);
        res.redirect('/products');
    }
});

// Delete single image
app.post('/products/:id/delete-image', requireAuth, async (req, res) => {
    try {
        const { imageUrl } = req.body;
        const productId = req.params.id;

        const [products] = await db.query('SELECT images FROM products WHERE id = ?', [productId]);
        if (products.length > 0) {
            let images = products[0].images ? JSON.parse(products[0].images) : [];
            images = images.filter(img => img !== imageUrl);
            await db.query('UPDATE products SET images = ? WHERE id = ?', [JSON.stringify(images), productId]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting image:', err.message);
        res.json({ success: false });
    }
});

// Admin Customers Routes

// List all customers
app.get('/admin/customers', requireAuth, async (req, res) => {
    try {
        const [customers] = await db.query('SELECT * FROM customers ORDER BY created_at DESC');
        res.render('admin/customers/list', { 
            customers,
            adminEmail: req.session.adminEmail,
            error: null
        });
    } catch (err) {
        console.error('Error fetching customers:', err.message);
        res.render('admin/customers/list', { 
            customers: [],
            adminEmail: req.session.adminEmail,
            error: 'Error fetching customers'
        });
    }
});

// Admin Orders Routes

// List all orders
app.get('/admin/orders', requireAuth, async (req, res) => {
    try {
        const [orders] = await db.query(`
            SELECT o.*, c.name as customer_name, c.email as customer_email 
            FROM orders o 
            JOIN customers c ON o.customer_id = c.id 
            ORDER BY o.created_at DESC
        `);
        res.render('admin/orders/list', { 
            orders,
            adminEmail: req.session.adminEmail,
            error: null
        });
    } catch (err) {
        console.error('Error fetching orders:', err.message);
        res.render('admin/orders/list', { 
            orders: [],
            adminEmail: req.session.adminEmail,
            error: 'Error fetching orders'
        });
    }
});

// Update order status
app.get('/admin/orders/:id/status/:status', requireAuth, async (req, res) => {
    try {
        const orderId = req.params.id;
        const status = req.params.status;

        const validStatuses = ['pending', 'processing', 'shipped', 'delivered'];
        if (!validStatuses.includes(status)) {
            return res.redirect('/admin/orders');
        }

        await db.query('UPDATE orders SET order_status = ? WHERE id = ?', [status, orderId]);
        res.redirect('/admin/orders');
    } catch (err) {
        console.error('Error updating order status:', err.message);
        res.redirect('/admin/orders');
    }
});

// Cancel order (admin)
app.get('/admin/orders/:id/cancel', requireAuth, async (req, res) => {
    try {
        const orderId = req.params.id;
        await db.query('UPDATE orders SET order_status = ? WHERE id = ?', ['cancelled', orderId]);
        res.redirect('/admin/orders');
    } catch (err) {
        console.error('Error cancelling order:', err.message);
        res.redirect('/admin/orders');
    }
});

// Start server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to start server:', err.message);
});
