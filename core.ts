
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
    mplCandyMachine as mplCoreCandyMachine, create,
    addConfigLines,
    fetchCandyMachine,
    deleteCandyMachine,
    mintV1,
} from "@metaplex-foundation/mpl-core-candy-machine";
import {
    Umi,
    PublicKey,
    generateSigner,
    transactionBuilder,
    keypairIdentity,
    some,
    sol,
    dateTime,
    TransactionBuilderSendAndConfirmOptions
} from '@metaplex-foundation/umi';
import { createCollectionV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';

const umi = createUmi('https://devnet.helius-rpc.com/?api-key=dae87da8-8a38-499b-90e0-7ec89896cbfe').use(mplCoreCandyMachine());

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

    // 1. Airdrop 100 SOL to the keypair
    try {
        await umi.rpc.airdrop(keypair.publicKey, sol(5), options.confirm);
        console.log(`1. ✅ - Airdropped 5 SOL to the ${keypair.publicKey.toString()}`)
    } catch (error) {
        console.error('1. ❌ - Error airdropping SOL to the wallet:', error);
    }

    // 2. Create a collection
    try {
        await createCollectionV1(umi, {
            collection: collectionMint,
            name: 'My Collection',
            uri: 'https://arweave.net/zgFQx7sWurSZnvQHLo08Krv7HISRLZA77yeYeU1-uHk',
        }).sendAndConfirm(umi, options);
        console.log(`2. ✅ - Created collection: ${collectionMint.publicKey.toString()}`)
    } catch (error) {
        console.error('2. ❌ - Error creating collection:', error);
    }

    // 3. Create a Candy Machine
    try {
        const createIx = await create(umi, {
            candyMachine,
            collection: collectionMint.publicKey,
            collectionUpdateAuthority: umi.identity,
            itemsAvailable: 3,
            authority: umi.identity.publicKey,
            isMutable: false,
            configLineSettings: some({
                prefixName: 'Quick NFT #',
                nameLength: 11,
                prefixUri: 'https://example.com/metadata/',
                uriLength: 65,
                isSequential: false,
            }),
            guards: {
                botTax: some({ lamports: sol(0.001), lastInstruction: true }),
                solPayment: some({ lamports: sol(1.5), destination: treasury.publicKey }),
                startDate: some({ date: dateTime('2023-04-04T16:00:00Z') }),
                // All other guards are disabled...
            }
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
    try {
        const numMints = 3;
        let minted = 0;
        for (let i = 0; i < numMints; i++) {
            await transactionBuilder()
                .add(setComputeUnitLimit(umi, { units: 800_000 }))
                .add(
                    mintV1(umi, {
                        candyMachine: candyMachine.publicKey,
                        asset: generateSigner(umi),
                        collection: collectionMint.publicKey,
                        mintArgs: {
                            solPayment: some({ destination: treasury.publicKey }),
                        },
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
        authority: umi.identity.publicKey,
        collection: collectionMint.publicKey,
        itemsRedeemed: 3,
    }, 7);

    // // 8. Delete the Candy Machine
    // try {
    //     await deleteCandyMachine(umi, {
    //         candyMachine: candyMachine.publicKey,
    //     }).sendAndConfirm(umi, options);
    //     console.log(`8. ✅ - Deleted the Candy Machine: ${candyMachine.publicKey.toString()}`);
    // } catch (error) {
    //     console.error('8. ❌ - Error deleting the Candy Machine:', error);
    // }

}
main().catch(console.error);