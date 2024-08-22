import { generateSigner } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
    Umi,
    PublicKey,
    transactionBuilder,
    keypairIdentity,
    some,
    sol,
    dateTime,
    TransactionBuilderSendAndConfirmOptions, 
    percentAmount
} from '@metaplex-foundation/umi';
import { 
    createNft, 
    TokenStandard 
} from '@metaplex-foundation/mpl-token-metadata'
import { 
    addConfigLines, 
    create, 
    fetchCandyMachine, 
    mintV2, 
    mplCandyMachine
} from '@metaplex-foundation/mpl-candy-machine'
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox'


const umi = createUmi('https://devnet.helius-rpc.com/?api-key=8106f8cc-5f78-4ea6-8e96-65ec288aeeee').use(mplCandyMachine());


const keypair = generateSigner(umi);
const collectionMint = generateSigner(umi);
const treasury = generateSigner(umi);
const candyMachine = generateSigner(umi);

umi.use(keypairIdentity(keypair));

const options: TransactionBuilderSendAndConfirmOptions = {
    send: { skipPreflight: true },
    confirm: { commitment: 'processed' }
};

async function main() {
    interface ExpectedCandyMachineState {
        itemsLoaded: number;
        itemsRedeemed: number;
        authority: PublicKey;
        collection: PublicKey;
    }

    async function checkCandyMachine(
        umi: Umi,
        candyMachine: PublicKey,
        expectedCandyMachineState: ExpectedCandyMachineState,
        step?: number
    ) {
        try {
            const loadedCandyMachine = await fetchCandyMachine(umi, candyMachine, options.confirm);
            const { itemsLoaded, itemsRedeemed, authority, collection } = expectedCandyMachineState;
            if (Number(loadedCandyMachine.itemsRedeemed) !== itemsRedeemed) {
                throw new Error('Incorrect number of items available in the Candy Machine.');
            }
            if (loadedCandyMachine.itemsLoaded !== itemsLoaded) {
                throw new Error('Incorrect number of items loaded in the Candy Machine.');
            }
            if (loadedCandyMachine.authority.toString() !== authority.toString()) {
                throw new Error('Incorrect authority in the Candy Machine.');
            }
            if (loadedCandyMachine.collectionMint.toString() !== collection.toString()) {
                throw new Error('Incorrect collection in the Candy Machine.');
            }
            step && console.log(`${step}. ✅ - Candy Machine has the correct configuration.`);
        } catch (error) {
            if (error instanceof Error) {
                step && console.log(`${step}. ❌ - Candy Machine incorrect configuration: ${error.message}`);
            } else {
                step && console.log(`${step}. ❌ - Error fetching the Candy Machine.`);
            }
        }
    }

    console.log(`Testing Candy Machine Core...`);
    console.log(`Important account information:`)
    console.table({
        keypair: keypair.publicKey.toString(),
        collectionMint: collectionMint.publicKey.toString(),
        treasury: treasury.publicKey.toString(),
        candyMachine: candyMachine.publicKey.toString(),
    });

    // 1. Airdrop 5 SOL to the keypair
    try {
        await umi.rpc.airdrop(keypair.publicKey, sol(5), options.confirm);
        console.log(`1. ✅ - Airdropped 5 SOL to the ${keypair.publicKey.toString()}`)
    } catch (error) {
        console.log('1. ❌ - Error airdropping SOL to the wallet.', error);
    }

    // 2. Create a collection
    const collectionUpdateAuthority = generateSigner(umi)
    try {
        await createNft(umi, {
            mint: collectionMint,
            authority: collectionUpdateAuthority,
            name: 'My Collection NFT',
            uri: 'https://arweave.net/zgFQx7sWurSZnvQHLo08Krv7HISRLZA77yeYeU1-uHk',
            sellerFeeBasisPoints: percentAmount(100, 2), // 9.99%
            isCollection: true,
            }).sendAndConfirm(umi, options)
        console.log(`2. ✅ - Created collection: ${collectionMint.publicKey.toString()}`)
    } catch (error) {
        console.error('2. ❌ - Error creating collection:', error);
    }


    // 3. Create a Candy Machine
    try {
        const createIx = await create(umi, {
            candyMachine,
            collectionMint: collectionMint.publicKey,
            collectionUpdateAuthority: collectionUpdateAuthority,
            tokenStandard: TokenStandard.NonFungible,
            sellerFeeBasisPoints: percentAmount(9.99, 2), // 9.99%
            itemsAvailable: 3,
            creators: [
                {
                address: umi.identity.publicKey,
                verified: true,
                percentageShare: 100,
                },
            ],
            configLineSettings: some({
                prefixName: 'Quick NFT #',
                nameLength: 32,
                prefixUri: 'https://example.com/metadata/',
                uriLength: 65,
                isSequential: false,
              }),
        });
        await createIx.sendAndConfirm(umi, options);
        console.log(`3. ✅ - Created Candy Machine: ${candyMachine.publicKey.toString()}`)
    } catch (error) {
        console.error('3. ❌ - Error creating Candy Machine:', error);
    }

    // 4. Add items to the Candy Machine
    try {
        await addConfigLines(umi, {
            candyMachine: candyMachine.publicKey,
            index: 0,
            configLines: [
                { name: '1', uri: 'https://arweave.net/gR62qxGsChALVAMdnyoq0KZzsSnN4VxYvx0ramlaJnY' },
                { name: '2', uri: 'https://arweave.net/Ya_V3r3k_c-BivoJiMUfO8vEpsi95c5dupYIh2cFdGo' },
                { name: '3', uri: 'https://arweave.net/8MPJnyFK0eBvYEKRgA6mxCBbGGEHIRXjC74Jl06ymDg' },
            ],
        }).sendAndConfirm(umi, options);
        console.log(`4. ✅ - Added items to the Candy Machine: ${candyMachine.publicKey.toString()}`)
    } catch (error) {
        console.error('4. ❌ - Error adding items to the Candy Machine:', error);
    }

    // 5. Verify the Candy Machine configuration
    await checkCandyMachine(umi, candyMachine.publicKey, {
        itemsLoaded: 3,
        authority: umi.identity.publicKey,
        collection: collectionMint.publicKey,
        itemsRedeemed: 0,
    }, 5);

    // 6. Mint NFTs
    const nftMint = generateSigner(umi)
    try {
        const numMints = 3;
        let minted = 0;
        for (let i = 0; i < numMints; i++) {
            await transactionBuilder()
                .add(setComputeUnitLimit(umi, { units: 800_000 }))
                .add(
                    mintV2(umi, {
                        candyMachine: candyMachine.publicKey,
                        nftMint,
                        collectionMint: collectionMint.publicKey,
                        collectionUpdateAuthority: collectionUpdateAuthority.publicKey
                    })
                )
                .sendAndConfirm(umi, options);
            minted++;
        }
        console.log(`6. ✅ - Minted ${minted} NFTs.`);
    } catch (error) {
        console.error('6. ❌ - Error minting NFTs:', error);
    }


    // 7. Verify the Candy Machine configuration
    await checkCandyMachine(umi, candyMachine.publicKey, {
        itemsLoaded: 3,
        authority: collectionUpdateAuthority.publicKey,
        collection: collectionMint.publicKey,
        itemsRedeemed: 3,
    }, 7);

    // 8. Delete the Candy Machine

}

main()