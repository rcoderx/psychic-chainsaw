require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { ethers } = require('ethers');
const JsonRpcProvider = ethers.JsonRpcProvider;
const provider = new JsonRpcProvider(process.env.INFURA_URL);
const contractABI = require('./ABI.json'); // Path to your ABI file
const contractAddress = process.env.CONTRACT_ADDRESS;
const contract = new ethers.Contract(contractAddress, contractABI, provider);

const app = express();
app.use(cors({
    origin: 'https://legendary-memory-ten.vercel.app/' // Replace with your front-end's domain
}));
const corsOptions = {
    origin: 'https://legendary-memory-ten.vercel.app',
    optionsSuccessStatus: 200
  };
  app.use(cors(corsOptions));
const rateLimit = require('express-rate-limit');
app.use(express.json());
// Trust the first proxy
app.set('trust proxy', 1);

// Apply rate limits to all requests
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(apiLimiter);


app.use(cors());
app.use(express.json());
// Scheduled task to reset lives at 12 AM UTC
const schedule = require('node-schedule');

schedule.scheduleJob('0 0 * * *', async function() {
    await Player.updateMany({}, { $set: { lives: 10 } });
    console.log('Lives reset for all players');
});

// Add this line to log the MongoDB URI
console.log('MongoDB URI:', process.env.MONGODB_URI);
// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));


// Define a schema for the leaderboard
const playerSchema = new mongoose.Schema({
    address: String,
    score: { type: Number, default: 0 },
    lives: { type: Number, default: 10 }
});
// Endpoint to save or update user
app.post('/saveUser', async (req, res) => {
    const { address } = req.body;

    try {
        console.log("POST /saveUser called with address:", address);

        let user = await Player.findOne({ address });

        if (!user) {
            user = new Player({ address, score: 0, lives: 10 });
            await user.save();
        }

        res.json({ message: 'User saved or updated', lives: user.lives });
    } catch (error) {
        console.error("Error in POST /saveUser:", error);
        res.status(500).send('Error saving user');
    }
});



const Player = mongoose.model('Player', playerSchema);

// Fetch leaderboard data
app.get('/leaderboard', async (req, res) => {
    try {
        const topPlayers = await Player.find().sort({ score: -1 }).limit(10);
        res.json(topPlayers);
    } catch (err) {
        console.error("Error in GET /leaderboard:", err);
        res.status(500).json({ message: err.message });
    }
});

app.post('/updateScore', async (req, res) => {
    const { address, score } = req.body;

    if (!address || !Number.isInteger(score)) {
        return res.status(400).send('Invalid input');
    }

    try {
        const player = await Player.findOneAndUpdate({ address }, { $inc: { score }}, { upsert: true, new: true });
        res.json(player);
    } catch (err) {
        console.error("Error in POST /updateScore:", err);
        res.status(500).json({ message: err.message });
    }
});

// Endpoint to update lives
app.post('/updateLives', async (req, res) => {
    try {
        console.log("POST /updateLives called with:", req.body);

    if (!address || !Number.isInteger(lives)) {
        return res.status(400).send('Invalid request');
    }

    try {
        await Player.findOneAndUpdate({ address }, { $set: { lives } });
        res.send('Lives updated successfully');
    } catch (error) {
        res.status(500).send('Error updating lives');
    }
} catch (error) {
    console.error("Error in POST /updateLives:", error);
    res.status(500).send('Error updating lives');
}
});


app.get('/getLives', async (req, res) => {
    const address = req.query.address;
    try {
        const player = await Player.findOne({ address });
        if (player) {
            res.json({ lives: player.lives });
        } else {
            res.status(404).send('Player not found');
        }
    } catch (err) {
        console.error("Error in GET /getLives:", err);
        res.status(500).send('Error retrieving lives');
    }
});
// Endpoint to distribute rewards to the top 100 players
// Common function for distributing rewards
async function distributeRewards() {
    try {
        const topPlayers = await Player.find().sort({ score: -1 }).limit(100);
        const totalScore = topPlayers.reduce((sum, player) => sum + player.score, 0);
        const totalRewardPool = ethers.utils.parseUnits('1000', 'ether');

        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const contract = new ethers.Contract(contractAddress, contractABI, wallet);

        for (const player of topPlayers) {
            const rewardAmount = (player.score / totalScore) * totalRewardPool;
            const tx = await contract.transfer(player.address, rewardAmount);
            await tx.wait();
        }
        
        console.log('Rewards distributed successfully');
        return 'Rewards distributed successfully';
    } catch (error) {
        console.error('Error distributing rewards:', error);
        throw new Error('Error distributing rewards');
    }
}

// POST endpoint to manually trigger reward distribution
app.post('/distributeRewards', async (req, res) => {
    try {
        const message = await distributeRewards();
        res.send(message);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Schedule automatic reward distribution at 12 AM UTC
schedule.scheduleJob('0 0 * * *', async function() {
    await distributeRewards();
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
