const express = require('express');
const shopStore = require('../services/shopStore');

const router = express.Router();
const ADMIN_TOKEN = process.env.SHOP_ADMIN_TOKEN || '';

function requireAdmin(req, res, next) {
    if (!ADMIN_TOKEN) return next();
    const token = req.header('x-admin-token');
    if (token && token === ADMIN_TOKEN) return next();
    return res.status(403).json({ error: 'Admin token required' });
}

router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'shop' });
});

router.get('/categories', (req, res) => {
    res.json({ categories: shopStore.getCategories() });
});

router.get('/products', (req, res) => {
    const products = shopStore.listProducts({
        q: req.query.q,
        category: req.query.category,
        minPrice: req.query.minPrice,
        maxPrice: req.query.maxPrice,
        sort: req.query.sort
    });
    res.json({ products });
});

router.get('/products/:id', (req, res) => {
    const product = shopStore.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product });
});

router.post('/products', requireAdmin, (req, res) => {
    const products = shopStore.listProducts();
    const payload = req.body || {};
    if (!payload.name || !payload.price || !payload.image) {
        return res.status(400).json({ error: 'Missing name, price, or image' });
    }
    const newProduct = {
        id: payload.id || shopStore.generateId('prd'),
        name: payload.name,
        description: payload.description || '',
        price: Number(payload.price),
        image: payload.image,
        category: payload.category || 'general',
        tags: payload.tags || [],
        stock: Number(payload.stock || 0),
        rating: Number(payload.rating || 0),
        createdAt: new Date().toISOString()
    };
    products.push(newProduct);
    shopStore.saveProducts(products);
    res.json({ product: newProduct });
});

router.put('/products/:id', requireAdmin, (req, res) => {
    const products = shopStore.listProducts();
    const index = products.findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Product not found' });
    const payload = req.body || {};
    products[index] = { ...products[index], ...payload };
    shopStore.saveProducts(products);
    res.json({ product: products[index] });
});

router.delete('/products/:id', requireAdmin, (req, res) => {
    const products = shopStore.listProducts();
    const next = products.filter(item => item.id !== req.params.id);
    shopStore.saveProducts(next);
    res.json({ status: 'deleted' });
});

router.post('/cart', (req, res) => {
    const cart = shopStore.getCart(null, true);
    res.json({ cartId: cart.id, cart: shopStore.computeCartView(cart) });
});

router.get('/cart/:cartId', (req, res) => {
    const cart = shopStore.getCart(req.params.cartId, false);
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    res.json({ cartId: cart.id, cart: shopStore.computeCartView(cart) });
});

router.post('/cart/:cartId/items', (req, res) => {
    const { productId, quantity } = req.body || {};
    if (!productId) return res.status(400).json({ error: 'Missing productId' });
    const product = shopStore.getProduct(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const cart = shopStore.addItem(req.params.cartId, productId, quantity || 1);
    res.json({ cartId: cart.id, cart: shopStore.computeCartView(cart) });
});

router.put('/cart/:cartId/items/:productId', (req, res) => {
    const quantity = Number(req.body?.quantity);
    if (Number.isNaN(quantity)) return res.status(400).json({ error: 'Invalid quantity' });
    const cart = shopStore.updateItem(req.params.cartId, req.params.productId, quantity);
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    res.json({ cartId: cart.id, cart: shopStore.computeCartView(cart) });
});

router.delete('/cart/:cartId/items/:productId', (req, res) => {
    const cart = shopStore.removeItem(req.params.cartId, req.params.productId);
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    res.json({ cartId: cart.id, cart: shopStore.computeCartView(cart) });
});

router.delete('/cart/:cartId', (req, res) => {
    const cart = shopStore.clearCart(req.params.cartId);
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    res.json({ cartId: cart.id, cart: shopStore.computeCartView(cart) });
});

router.post('/checkout/:cartId', (req, res) => {
    const result = shopStore.checkout(req.params.cartId, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ order: result });
});

router.post('/auth/register', (req, res) => {
    const result = shopStore.registerUser(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
});

router.post('/auth/login', (req, res) => {
    const result = shopStore.loginUser(req.body || {});
    if (result.error) return res.status(401).json({ error: result.error });
    res.json(result);
});

router.get('/auth/me', (req, res) => {
    const token = req.header('x-user-token');
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const user = shopStore.getUserByToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

module.exports = router;
