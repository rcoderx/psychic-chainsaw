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
    origin: 'https://legendary-memory-rose.vercel.app' // Replace with your front-end's domain
}));
const corsOptions = {
    origin: 'https://legendary-memory-rose.vercel.app',
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
    // Fetch players from the database
    const players = await Player.find({});
    if (players.length === 0) {
        return []; // No players to distribute rewards to
    }

    // Calculate total score
    const totalScore = players.reduce((acc, player) => acc + player.score, 0);
    if (totalScore === 0) {
        return []; // No scores to calculate rewards
    }

    // Define total distribution amount (example: 1000 tokens)
    const totalDistributionAmount = 1000;

    // Calculate rewards for each player
    const rewards = players.map(player => {
        const playerFraction = player.score / totalScore;
        let rewardAmount = Math.ceil(playerFraction * totalDistributionAmount); // Round up to nearest whole number
        return {
            address: player.address,
            reward: rewardAmount
        };
    });

    return rewards;
}


function toSmallestTokenUnit(amount, decimals) {
    return BigInt(amount) * BigInt(10 ** decimals);
}

async function distributeRewards(playerRewards) {
    // Ensure there are rewards to distribute
    if (playerRewards.length === 0) {
        console.log('No rewards to distribute');
        return;
    }

    // Prepare the addresses and amounts arrays
    const addresses = playerRewards.map(reward => reward.address);
    const amounts = playerRewards.map(reward => toSmallestTokenUnit(reward.reward, 18)); // Convert to smallest unit using the custom function

    // Initialize the wallet and contract for transactions
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const rewardContract = new ethers.Contract(contractAddress, contractABI, wallet);

    try {
        // Call the distributeRewards function of the smart contract
        const tx = await rewardContract.distributeRewards(addresses, amounts.map(amount => amount.toString()));
        await tx.wait();
        console.log(`Rewards distributed successfully`);
    } catch (error) {
        console.error(`Error distributing rewards:`, error);
    }
}

async function resetScoresAndRewards() {
    try {
        // Reset scores and rewards for all players
        await Player.updateMany({}, { score: 0, reward: 0 });
        console.log('Scores and rewards reset successfully.');
    } catch (error) {
        console.error('Error resetting scores and rewards:', error);
    }
}

app.post('/reset-scores-rewards', async (req, res) => {
    try {
        await resetScoresAndRewards();
        res.json({ message: 'Scores and rewards reset successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Error resetting scores and rewards' });
    }
});


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
