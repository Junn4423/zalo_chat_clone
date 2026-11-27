import express from 'express';
import { login, logout, syncAllUsers } from '../controllers/auth.controller.js';
import { protect } from '../../middleware/auth.middleware.js';

const router = express.Router();

router.post("/login", login);
router.post("/logout", protect, logout);
router.post("/sync-users", protect, syncAllUsers);

export default router;
