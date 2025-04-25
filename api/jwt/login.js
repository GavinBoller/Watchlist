const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const z = require('zod');

const app = express();
app.use(express.json());

const scryptAsync = promisify(scrypt);

// Simple login schema for validation
const simpleLoginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
});

// Mocked user lookup (replace with database lookup later)
const mockGetUserByUsername = async (username) => {
    // Placeholder: Simulate a user with a bcrypt-hashed password
    // In production, this will query a Neon PostgreSQL database
    if (username === 'testuser') {
        return {
            id: 1,
            username: 'testuser',
            password: '$2a$10$examplehashedpassword1234567890', // Mock bcrypt hash
            displayName: 'Test User',
            createdAt: new Date()
        };
    }
    return null;
};

// Copied from server/jwtAuth.js (inferred implementation)
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const createUserResponse = (user) => ({
    userId: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    createdAt: user.createdAt
});
const generateToken = (userResponse) => {
    return jwt.sign(userResponse, JWT_SECRET, { expiresIn: '7d' });
};

app.post('/api/jwt/login', async (req, res) => {
    console.log('[SIMPLE LOGIN] Beginning login request');

    try {
        // Validate the request body
        const validationResult = simpleLoginSchema.safeParse(req.body);
        if (!validationResult.success) {
            return res.status(400).json({
                error: 'Invalid login data',
                details: validationResult.error.errors
            });
        }

        const { username, password } = validationResult.data;
        console.log(`[SIMPLE LOGIN] Attempting login for user: ${username}`);

        // Look up the user (mocked for now)
        const user = await mockGetUserByUsername(username);
        if (!user) {
            console.log(`[SIMPLE LOGIN] User not found: ${username}`);
            return res.status(401).json({
                error: 'Invalid username or password',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Compare passwords
        let passwordMatch = false;

        // First try with bcrypt (for bcrypt-hashed passwords)
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
            try {
                passwordMatch = await bcrypt.compare(password, user.password);
            } catch (bcryptError) {
                console.error('[SIMPLE LOGIN] Bcrypt comparison error:', bcryptError);
            }
        }

        // If bcrypt didn't work, try the crypto-based comparison (for custom format)
        if (!passwordMatch && user.password.includes('.')) {
            try {
                const [hashedPassword, salt] = user.password.split('.');
                const keyBuffer = (await scryptAsync(password, salt, 64));
                const storedBuffer = Buffer.from(hashedPassword, 'hex');

                if (keyBuffer.length === storedBuffer.length) {
                    passwordMatch = timingSafeEqual(keyBuffer, storedBuffer);
                }
            } catch (cryptoError) {
                console.error('[SIMPLE LOGIN] Crypto comparison error:', cryptoError);
            }
        }

        // Handle failed password match
        if (!passwordMatch) {
            console.log(`[SIMPLE LOGIN] Password mismatch for user: ${username}`);
            return res.status(401).json({
                error: 'Invalid username or password',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Generate JWT token
        console.log(`[SIMPLE LOGIN] Generating token for user: ${username}`);
        const userResponse = createUserResponse(user);
        const token = generateToken(userResponse);

        // Return success with token and user data
        console.log(`[SIMPLE LOGIN] Login successful for user: ${username}`);
        return res.status(200).json({
            token,
            user: userResponse
        });
    } catch (error) {
        console.error('[SIMPLE LOGIN] Error during login:', error);

        // Enhanced error reporting
        let errorMessage = 'Login failed due to an internal error';
        let statusCode = 500;
        let errorCode = 'LOGIN_FAILED';

        if (error instanceof Error) {
            console.error('[SIMPLE LOGIN] Error name:', error.name);
            console.error('[SIMPLE LOGIN] Error message:', error.message);

            // Detect specific error types
            if (error.message.includes('connection') || error.message.includes('timeout')) {
                errorMessage = 'Database connection issue, please try again';
                statusCode = 503;
                errorCode = 'SERVICE_UNAVAILABLE';
            }
        }

        return res.status(statusCode).json({
            error: errorMessage,
            code: errorCode,
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

module.exports = app;