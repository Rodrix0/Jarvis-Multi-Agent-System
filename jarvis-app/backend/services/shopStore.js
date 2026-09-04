const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'shop');
const FILES = {
    products: path.join(DATA_DIR, 'products.json'),
    carts: path.join(DATA_DIR, 'carts.json'),
    orders: path.join(DATA_DIR, 'orders.json'),
    users: path.join(DATA_DIR, 'users.json')
};

const TAX_RATE = 0.18;

const DEFAULT_PRODUCTS = [
    {
        id: 'prd_tee_black',
        name: 'Camiseta Negra Premium',
        description: 'Camiseta de algodon suave con corte moderno.',
        price: 25.99,
        image: 'https://source.unsplash.com/featured/800x800?black-tshirt',
        category: 'tops',
        tags: ['basic', 'minimal', 'cotton'],
        stock: 48,
        rating: 4.7,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_tee_white',
        name: 'Camiseta Blanca Essential',
        description: 'Blanco limpio, ideal para layering.',
        price: 22.5,
        image: 'https://source.unsplash.com/featured/800x800?white-tshirt',
        category: 'tops',
        tags: ['basic', 'neutral'],
        stock: 60,
        rating: 4.6,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_hoodie_gray',
        name: 'Hoodie Gris Urban',
        description: 'Buzo con capucha, fit relajado.',
        price: 49.99,
        image: 'https://source.unsplash.com/featured/800x800?hoodie',
        category: 'outerwear',
        tags: ['street', 'warm'],
        stock: 36,
        rating: 4.8,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_jean_dark',
        name: 'Jean Azul Oscuro',
        description: 'Denim elastico para uso diario.',
        price: 59.99,
        image: 'https://source.unsplash.com/featured/800x800?jeans',
        category: 'jeans',
        tags: ['denim', 'classic'],
        stock: 42,
        rating: 4.5,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_jean_light',
        name: 'Jean Azul Claro',
        description: 'Lavado claro con detalle vintage.',
        price: 57.5,
        image: 'https://source.unsplash.com/featured/800x800?light-jeans',
        category: 'jeans',
        tags: ['denim', 'vintage'],
        stock: 33,
        rating: 4.4,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_jacket_leather',
        name: 'Chaqueta Cuero Noir',
        description: 'Cuero sintetico premium con cierre metalico.',
        price: 129.0,
        image: 'https://source.unsplash.com/featured/800x800?leather-jacket',
        category: 'outerwear',
        tags: ['statement', 'night'],
        stock: 12,
        rating: 4.9,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_coat_wool',
        name: 'Abrigo Lana Cafe',
        description: 'Abrigo largo con textura suave.',
        price: 149.99,
        image: 'https://source.unsplash.com/featured/800x800?wool-coat',
        category: 'outerwear',
        tags: ['winter', 'premium'],
        stock: 10,
        rating: 4.8,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_dress_midnight',
        name: 'Vestido Midnight',
        description: 'Vestido elegante para eventos nocturnos.',
        price: 89.99,
        image: 'https://source.unsplash.com/featured/800x800?black-dress',
        category: 'dresses',
        tags: ['party', 'elegant'],
        stock: 20,
        rating: 4.7,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_dress_sand',
        name: 'Vestido Sand Flow',
        description: 'Textura ligera para dias calidos.',
        price: 75.5,
        image: 'https://source.unsplash.com/featured/800x800?summer-dress',
        category: 'dresses',
        tags: ['summer', 'flowy'],
        stock: 25,
        rating: 4.5,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_sneaker_white',
        name: 'Zapatillas White Storm',
        description: 'Sneakers minimalistas con suela comoda.',
        price: 79.99,
        image: 'https://source.unsplash.com/featured/800x800?white-sneakers',
        category: 'shoes',
        tags: ['sneaker', 'street'],
        stock: 54,
        rating: 4.6,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_boots_black',
        name: 'Botas Black Ridge',
        description: 'Botas urbanas resistentes.',
        price: 109.99,
        image: 'https://source.unsplash.com/featured/800x800?boots',
        category: 'shoes',
        tags: ['boots', 'durable'],
        stock: 18,
        rating: 4.7,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_cap_neutral',
        name: 'Gorra Neutral',
        description: 'Gorra basica con ajuste trasero.',
        price: 19.99,
        image: 'https://source.unsplash.com/featured/800x800?cap',
        category: 'accessories',
        tags: ['cap', 'casual'],
        stock: 70,
        rating: 4.4,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_bag_canvas',
        name: 'Bolsa Canvas Eco',
        description: 'Bolsa reutilizable con disenio minimal.',
        price: 12.99,
        image: 'https://source.unsplash.com/featured/800x800?tote-bag',
        category: 'accessories',
        tags: ['eco', 'bag'],
        stock: 90,
        rating: 4.3,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_watch_sport',
        name: 'Reloj Sport Edge',
        description: 'Reloj resistente con estetica deportiva.',
        price: 64.99,
        image: 'https://source.unsplash.com/featured/800x800?sport-watch',
        category: 'accessories',
        tags: ['watch', 'sport'],
        stock: 35,
        rating: 4.5,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_skirt_midi',
        name: 'Falda Midi Flow',
        description: 'Falda midi con corte fluido.',
        price: 44.5,
        image: 'https://source.unsplash.com/featured/800x800?skirt',
        category: 'bottoms',
        tags: ['midi', 'soft'],
        stock: 28,
        rating: 4.4,
        createdAt: new Date().toISOString()
    },
    {
        id: 'prd_pants_tailor',
        name: 'Pantalon Tailor Fit',
        description: 'Pantalon formal con fit moderno.',
        price: 69.99,
        image: 'https://source.unsplash.com/featured/800x800?trousers',
        category: 'bottoms',
        tags: ['formal', 'office'],
        stock: 24,
        rating: 4.6,
        createdAt: new Date().toISOString()
    }
];

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function ensureFiles() {
    ensureDataDir();
    if (!fs.existsSync(FILES.products)) {
        writeJson(FILES.products, DEFAULT_PRODUCTS);
    }
    if (!fs.existsSync(FILES.carts)) {
        writeJson(FILES.carts, {});
    }
    if (!fs.existsSync(FILES.orders)) {
        writeJson(FILES.orders, []);
    }
    if (!fs.existsSync(FILES.users)) {
        writeJson(FILES.users, []);
    }
}

function generateId(prefix) {
    const rand = crypto.randomBytes(6).toString('hex');
    return `${prefix}_${rand}`;
}

function normalize(text) {
    return String(text || '').toLowerCase().trim();
}

function listProducts(filters = {}) {
    const products = readJson(FILES.products, DEFAULT_PRODUCTS);
    let result = [...products];

    if (filters.q) {
        const q = normalize(filters.q);
        result = result.filter(item =>
            normalize(item.name).includes(q) ||
            normalize(item.description).includes(q) ||
            (item.tags || []).some(tag => normalize(tag).includes(q))
        );
    }

    if (filters.category) {
        const cat = normalize(filters.category);
        result = result.filter(item => normalize(item.category) === cat);
    }

    if (filters.minPrice !== undefined) {
        const min = Number(filters.minPrice);
        if (!Number.isNaN(min)) {
            result = result.filter(item => item.price >= min);
        }
    }

    if (filters.maxPrice !== undefined) {
        const max = Number(filters.maxPrice);
        if (!Number.isNaN(max)) {
            result = result.filter(item => item.price <= max);
        }
    }

    if (filters.sort) {
        const sort = filters.sort;
        if (sort === 'price_asc') result.sort((a, b) => a.price - b.price);
        if (sort === 'price_desc') result.sort((a, b) => b.price - a.price);
        if (sort === 'name_asc') result.sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
}

function getProduct(productId) {
    const products = readJson(FILES.products, DEFAULT_PRODUCTS);
    return products.find(p => p.id === productId);
}

function saveProducts(products) {
    writeJson(FILES.products, products);
}

function getCategories() {
    const products = readJson(FILES.products, DEFAULT_PRODUCTS);
    const categories = new Set(products.map(p => p.category));
    return Array.from(categories).sort();
}

function getCarts() {
    return readJson(FILES.carts, {});
}

function saveCarts(carts) {
    writeJson(FILES.carts, carts);
}

function getCart(cartId, createIfMissing = true) {
    const carts = getCarts();
    if (!cartId || !carts[cartId]) {
        if (!createIfMissing) return null;
        const newId = generateId('cart');
        carts[newId] = {
            id: newId,
            items: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveCarts(carts);
        return carts[newId];
    }
    return carts[cartId];
}

function computeCartView(cart) {
    const products = readJson(FILES.products, DEFAULT_PRODUCTS);
    const items = cart.items.map(item => {
        const product = products.find(p => p.id === item.productId);
        return {
            productId: item.productId,
            quantity: item.quantity,
            product: product || null,
            lineTotal: product ? product.price * item.quantity : 0
        };
    });

    const subTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const tax = subTotal * TAX_RATE;
    const total = subTotal + tax;

    return {
        id: cart.id,
        items,
        subTotal: Number(subTotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        total: Number(total.toFixed(2)),
        currency: 'USD',
        updatedAt: cart.updatedAt
    };
}

function addItem(cartId, productId, quantity = 1) {
    const carts = getCarts();
    const cart = getCart(cartId, true);
    if (!cart) return null;

    const qty = Math.max(1, Number(quantity) || 1);
    const existing = cart.items.find(item => item.productId === productId);
    if (existing) {
        existing.quantity += qty;
    } else {
        cart.items.push({ productId, quantity: qty });
    }
    cart.updatedAt = new Date().toISOString();
    carts[cart.id] = cart;
    saveCarts(carts);
    return cart;
}

function updateItem(cartId, productId, quantity) {
    const carts = getCarts();
    const cart = carts[cartId];
    if (!cart) return null;

    const qty = Number(quantity);
    cart.items = cart.items.filter(item => item.productId !== productId);
    if (!Number.isNaN(qty) && qty > 0) {
        cart.items.push({ productId, quantity: qty });
    }

    cart.updatedAt = new Date().toISOString();
    carts[cartId] = cart;
    saveCarts(carts);
    return cart;
}

function removeItem(cartId, productId) {
    return updateItem(cartId, productId, 0);
}

function clearCart(cartId) {
    const carts = getCarts();
    if (carts[cartId]) {
        carts[cartId].items = [];
        carts[cartId].updatedAt = new Date().toISOString();
        saveCarts(carts);
        return carts[cartId];
    }
    return null;
}

function checkout(cartId, customer = {}) {
    const cart = getCart(cartId, false);
    if (!cart) return { error: 'Cart not found' };

    const cartView = computeCartView(cart);
    if (!cartView.items.length) return { error: 'Cart is empty' };

    const orders = readJson(FILES.orders, []);
    const order = {
        id: generateId('order'),
        items: cartView.items,
        subTotal: cartView.subTotal,
        tax: cartView.tax,
        total: cartView.total,
        currency: cartView.currency,
        status: 'paid',
        customer,
        createdAt: new Date().toISOString()
    };

    orders.push(order);
    writeJson(FILES.orders, orders);

    clearCart(cartId);

    return order;
}

function registerUser(payload) {
    const users = readJson(FILES.users, []);
    const email = normalize(payload.email);
    if (!email || !payload.password) {
        return { error: 'Missing email or password' };
    }
    if (users.some(u => u.email === email)) {
        return { error: 'User already exists' };
    }
    const hash = crypto.createHash('sha256').update(payload.password).digest('hex');
    const user = {
        id: generateId('user'),
        name: payload.name || 'User',
        email,
        passwordHash: hash,
        token: null,
        createdAt: new Date().toISOString()
    };
    users.push(user);
    writeJson(FILES.users, users);
    return { id: user.id, name: user.name, email: user.email };
}

function loginUser(payload) {
    const users = readJson(FILES.users, []);
    const email = normalize(payload.email);
    const hash = crypto.createHash('sha256').update(payload.password || '').digest('hex');
    const user = users.find(u => u.email === email && u.passwordHash === hash);
    if (!user) return { error: 'Invalid credentials' };

    user.token = crypto.randomBytes(16).toString('hex');
    writeJson(FILES.users, users);
    return { token: user.token, user: { id: user.id, name: user.name, email: user.email } };
}

function getUserByToken(token) {
    const users = readJson(FILES.users, []);
    return users.find(u => u.token === token) || null;
}

ensureFiles();

module.exports = {
    listProducts,
    getProduct,
    saveProducts,
    getCategories,
    getCart,
    computeCartView,
    addItem,
    updateItem,
    removeItem,
    clearCart,
    checkout,
    registerUser,
    loginUser,
    getUserByToken,
    generateId,
    readJson,
    writeJson,
    FILES
};
