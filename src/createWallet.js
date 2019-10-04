import { ethers } from 'ethers';

const wallet = ethers.Wallet.createRandom();
console.log(wallet.privateKey, wallet.address);
