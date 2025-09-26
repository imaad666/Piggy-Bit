// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract PythConsumer {
    IPyth public immutable pyth;

    struct StoredPrice {
        int64 price; // raw price
        uint64 conf; // confidence interval
        int32 expo;  // exponent (decimal scaling)
        uint64 publishTime;
    }

    mapping(bytes32 => StoredPrice) public lastPrice;

    event PriceUpdated(bytes32 indexed id, int64 price, int32 expo, uint64 publishTime);

    constructor(address pythContract) {
        pyth = IPyth(pythContract);
    }

    // Pulls from Hermes via frontend and updates Pyth, then stores the price for `feedId`.
    function updateAndStore(bytes[] calldata priceUpdate, bytes32 feedId, uint stalenessSeconds) external payable {
        uint fee = pyth.getUpdateFee(priceUpdate);
        require(msg.value >= fee, "insufficient fee");
        pyth.updatePriceFeeds{value: fee}(priceUpdate);

        PythStructs.Price memory p = pyth.getPriceNoOlderThan(feedId, stalenessSeconds);
        lastPrice[feedId] = StoredPrice({
            price: p.price,
            conf: p.conf,
            expo: p.expo,
            publishTime: uint64(p.publishTime)
        });

        // refund any extra
        if (msg.value > fee) {
            payable(msg.sender).transfer(msg.value - fee);
        }

        emit PriceUpdated(feedId, p.price, p.expo, uint64(p.publishTime));
    }
}


