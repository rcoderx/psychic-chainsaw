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
    origin: 'https://legendary-memory-ten.vercel.app' // Replace with your front-end's domain
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

app.post('/updateLives', async (req, res) => {
    const { address, livesChange } = req.body;

    if (!address || !Number.isInteger(livesChange)) {
        return res.status(400).send('Invalid request');
    }

    try {
        const player = await Player.findOne({ address });
        if (!player) {
            return res.status(404).send('Player not found');
        }

        // Update the lives and ensure it doesn't go below zero
        player.lives = Math.max(0, player.lives + livesChange);
        await player.save();

        res.json({ lives: player.lives });
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
async function calculateRewards() {
    const topPlayers = await Player.find().sort({ score: -1 }).limit(100);
    const totalScore = topPlayers.reduce((sum, player) => sum + player.score, 0);
    const totalRewardPool = ethers.utils.parseUnits('1000', '18');

    let playerRewards = topPlayers.map(player => {
        const rewardFraction = player.score / totalScore;
        const rewardAmount = Math.floor(rewardFraction * ethers.utils.formatUnits(totalRewardPool, '18'));
        const rewardInTokenUnits = ethers.utils.parseUnits(rewardAmount.toString(), '18');
        return { address: player.address, reward: rewardInTokenUnits };
    });

    return playerRewards;
}

async function distributeRewards(playerRewards) {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(contractAddress, contractABI, wallet);

    for (const rewardInfo of playerRewards) {
        try {
            console.log(`Distributing ${ethers.utils.formatUnits(rewardInfo.reward, '18')} tokens to ${rewardInfo.address}`);
            const tx = await contract.transfer(rewardInfo.address, rewardInfo.reward);
            await tx.wait();
            console.log(`Successfully distributed to ${rewardInfo.address}`);
        } catch (error) {
            console.error(`Error distributing rewards to ${rewardInfo.address}:`, error);
        }
    }
}
// Endpoint to calculate rewards
app.post('/calculate-rewards', async (req, res) => {
    try {
        const rewards = await calculateRewards();
        console.log('Rewards calculated:', rewards);
        res.json(rewards);
    } catch (error) {
        console.error('Error calculating rewards:', error);
        res.status(500).json({ error: 'Error calculating rewards' });
    }
});

// Endpoint to distribute rewards
app.post('/distribute-rewards', async (req, res) => {
    try {
        const rewards = await calculateRewards();
        await distributeRewards(rewards);
        console.log('Rewards distributed');
        res.json({ message: 'Rewards distributed successfully' });
    } catch (error) {
        console.error('Error distributing rewards:', error);
        res.status(500).json({ error: 'Error distributing rewards' });
    }
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
