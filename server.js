require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const provider = new ethers.providers.JsonRpcProvider(process.env.INFURA_URL);
const contractABI = require('./ABI.json'); // Path to your ABI file
const contractAddress = process.env.CONTRACT_ADDRESS;
const contract = new ethers.Contract(contractAddress, contractABI, provider);
const { ethers } = require('ethers');

const app = express();
app.use(cors({
    origin: 'http://your-frontend-domain.com' // Replace with your front-end's domain
}));
const rateLimit = require('express-rate-limit');

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


// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define a schema for the leaderboard
const playerSchema = new mongoose.Schema({
    address: String,
    score: Number,
    
        address: String,
        score: Number,
        lives: { type: Number, default: 10 } // New field for lives
    });
    

const Player = mongoose.model('Player', playerSchema);

// Fetch leaderboard data
app.get('/leaderboard', async (req, res) => {
    try {
        const topPlayers = await Player.find().sort({ score: -1 }).limit(10);
        res.json(topPlayers);
    } catch (err) {
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
        res.status(500).json({ message: err.message });
    }
});

// Endpoint to update lives
app.post('/updateLives', async (req, res) => {
    const { address, lives } = req.body;
    if (!address || !Number.isInteger(score)) {
        return res.status(400).send('Invalid input');
    }
    try {
        await Player.findOneAndUpdate({ address }, { $set: { lives }});
        res.send('Lives updated successfully');
    } catch (err) {
        res.status(500).send('Error updating lives');
    }
});
app.post('/updateLives', async (req, res) => {
    const { address, lives } = req.body;
    if (!address || !Number.isInteger(score)) {
        return res.status(400).send('Invalid input');
    }
    try {
        await Player.findOneAndUpdate({ address }, { $set: { lives }});
        res.send('Lives updated successfully');
    } catch (err) {
        res.status(500).send('Error updating lives');
    }
});

app.get('/getLives', async (req, res) => {
    const address = req.query.address;
    if (!address || !Number.isInteger(score)) {
        return res.status(400).send('Invalid input');
    }
    try {
        const player = await Player.findOne({ address });
        if (player) {
            res.json({ lives: player.lives });
        } else {
            res.status(404).send('Player not found');
        }
    } catch (err) {
        res.status(500).send('Error retrieving lives');
    }
});

// Assuming you have the Web3 setup and smart contract initialization as before

// Endpoint to distribute rewards to the top 100 players
app.post('/distributeRewards', async (req, res) => {
    try {
        // Fetch the top 100 players based on their scores
        const topPlayers = await Player.find().sort({ score: -1 }).limit(100);

        // Calculate the total score of the top 100 players
        const totalScore = topPlayers.reduce((sum, player) => sum + player.score, 0);

        // Calculate the reward for each player
        // Assuming 'totalRewardPool' is the total amount of tokens to be distributed
        const totalRewardPool = 0;  /* Total reward tokens */
        const rewards = topPlayers.map(player => ({
            address: player.address,
            amount: (player.score / totalScore) * totalRewardPool
        }));

        // Distribute rewards using the smart contract
        for (const reward of rewards) {
            await contract.methods.transfer(reward.address, reward.amount)
                .send({ from: web3.eth.defaultAccount }); // Ensure this account has enough Ether for gas
        }

        res.send('Rewards distributed successfully');
    } catch (error) {
        console.error('Error distributing rewards:', error);
        res.status(500).send('Error distributing rewards');
    }
});

// Web3 and Smart Contract Setup

// Function to distribute rewards
app.post('/distributeRewards', async (req, res) => {
    const { winners } = req.body; // Array of winner objects with address and reward amount
    const privateKey = process.env.PRIVATE_KEY; // Private key of the account sending transactions

    try {
        const account = web3.eth.accounts.privateKeyToAccount('0x' + privateKey);
        web3.eth.accounts.wallet.add(account);
        web3.eth.defaultAccount = account.address;

        for (const winner of winners) {
            const transfer = contract.methods.transfer(winner.address, winner.amount);
            const options = {
                to: transfer._parent._address,
                data: transfer.encodeABI(),
                gas: await transfer.estimateGas({from: account.address}),
            };
            const signed = await web3.eth.accounts.signTransaction(options, '0x' + privateKey);
            await web3.eth.sendSignedTransaction(signed.rawTransaction);
        }

        res.send('Rewards distributed successfully');
    } catch (error) {
        console.error('Error distributing rewards:', error);
        res.status(500).send('Error distributing rewards');
    }
    schedule.scheduleJob('0 0 * * *', async function() {
        await distributeRewards();
    });
});
async function distributeRewards() {
    try {
        const topPlayers = await Player.find().sort({ score: -1 }).limit(100);
        const totalScore = topPlayers.reduce((sum, player) => sum + player.score, 0);
        const totalRewardPool = 1000; // Total reward tokens, adjust as necessary

        const contract = new ethers.Contract(contractAddress, contractABI, provider.getSigner());
        for (const player of topPlayers) {
            const rewardAmount = ethers.utils.parseUnits((player.score / totalScore * totalRewardPool).toString(), 'ether');
            const tx = await contract.transfer(player.address, rewardAmount);
            await tx.wait();
        }

        console.log('Rewards distributed successfully');
    } catch (error) {
        console.error('Error distributing rewards:', error);
    }
}


// Schedule the reward distribution to occur daily at 12 AM UTC
schedule.scheduleJob('0 0 * * *', async function() {
    await distributeRewards();
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
