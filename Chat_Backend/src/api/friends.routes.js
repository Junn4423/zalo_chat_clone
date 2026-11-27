import {Router} from 'express';
import {protect} from '../../middleware/auth.middleware.js';
import {listFriends, discoverUsers, requestFriend, acceptFriend, deleteRequest, removeFriend} from '../controllers/friends.controller.js';

const router = Router();
router.use(protect);
router.get('/', listFriends);
router.get('/discover', discoverUsers);
router.post('/requests', requestFriend);
router.post('/requests/:id/accept', acceptFriend);
router.delete('/requests/:id', deleteRequest);
router.delete('/:id', removeFriend);
export default router;
