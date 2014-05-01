var osc = osc || {};

(function () {

    osc.readString = function (data, offsetState) {
        var charCodes = [],
            idx = offsetState.idx;

        for (; idx < data.byteLength; idx++) {
            var charCode = data.getUint8(idx);
            if (charCode !== 0) {
                charCodes.push(charCode);
            } else {
                idx++;
                break;
            }
        }

        // Round to the nearest 4-byte block.
        idx = (idx + 3) & ~0x03;
        offsetState.idx = idx;

        return String.fromCharCode.apply(null, charCodes);
    };

    osc.readPrimitive = function (data, readerName, numBytes, offsetState) {
        var val = data[readerName](offsetState.idx, false);
        offsetState.idx += numBytes;

        return val;
    };

    osc.readInt32 = function (data, offsetState) {
        return osc.readPrimitive(data, "getInt32", 4, offsetState);
    };

    osc.readFloat32 = function (data, offsetState) {
        return osc.readPrimitive(data, "getFloat32", 4, offsetState);
    };

    osc.writePrimitive = function (val, dv, writerName, numBytes, offset) {
        offset = offset === undefined ? 0 : offset;
        dv[writerName](offset, val, false);

        return dv.buffer;
    };

    osc.writeInt32 = function (val, dv, offset) {
        return osc.writePrimitive(val, dv, "setInt32", 4, offset);
    };

    osc.writeFloat32 = function (val, dv, offset) {
        return osc.writePrimitive(val, dv, "setFloat32", 4, offset);
    };

    osc.readBlob = function (data, offsetState) {
        var dataLength = osc.readInt32(data, offsetState),
            paddedLength = (dataLength + 3) & ~0x03,
            blob = new Uint8Array(data.buffer, offsetState.idx, dataLength);

        offsetState.idx += paddedLength;

        return blob;
    };

    osc.normalizeBuffer = function (obj) {
        if (obj instanceof ArrayBuffer) {
            return obj;
        } else if (obj.buffer) {
            // TypedArray or DataView
            return obj.buffer;
        }

        // Node.js Buffer or something we'll assume is array-like.
        obj.byteLength = obj.length;
        return obj;
    };

    osc.writeBlob = function (data) {
        data = osc.normalizeBuffer(data);

        var dataLength = data.byteLength,
            paddedLength = (dataLength + 3) & ~0x03,
            offset = 4, // Extra 4 bytes is for the size.
            msgLength = paddedLength + offset,
            msgBuffer = new ArrayBuffer(msgLength),
            dv = new DataView(msgBuffer);

        // Write the size.
        osc.writeInt32(paddedLength, dv);

        // Write the data.
        // Since we're using an ArrayBuffer, we don't need to pad the remaining bytes.
        for (var i = 0; i < dataLength; i++, offset++) {
            dv.setUint8(offset, arrayBuf[i]);
        }

        return dv.buffer;
    };

    osc.readTrue = function () {
        return true;
    };

    osc.readFalse = function () {
        return false;
    };

    osc.readNull = function () {
        return null;
    };

    osc.readImpulse = function () {
        return 1.0;
    };

    osc.readTimeTag = function (data, offsetState) {
        // TODO: Implement.
    };

    osc.readArguments = function (data, offsetState, withMetadata) {
        var typeTagString = osc.readString(data, offsetState);
        if (typeTagString.indexOf(",") !== 0) {
            // Despite what the OSC 1.0 spec says,
            // it just doesn't make sense to handle messages without type tags.
            // scsynth appears to read such messages as if they have a single
            // Uint8 argument. sclang throws an error if the type tag is omitted.
            throw new Error("A malformed type tag string was found while reading " +
                "the arguments of an OSC message. String was: " +
                typeTagString, " at offset: " + offsetState.idx);
        }

        var argTypes = typeTagString.substring(1).split(""),
            args = [];

        for (var i = 0; i < argTypes.length; i++) {
            var argType = argTypes[i],
                argReader = osc.argumentReaders[argType];

            if (!argReader) {
                throw new Error("'" + argType + "' is not a valid OSC type tag. Type tag string was: " +
                    typeTagString);
            }

            var arg = osc[argReader](data, offsetState);

            if (withMetadata) {
                arg = {
                    type: argType,
                    value: arg
                };
            }

            args.push(arg);
        }

        return args;
    };

    osc.readMessage = function (data, offsetState, withMetadata) {
        data = osc.makeDataView(data);
        offsetState = offsetState || {
            idx: 0
        };

        var address = osc.readString(data, offsetState);
        if (address.indexOf("/") !== 0) {
            throw new Error("A malformed OSC address was found while reading " +
                "an OSC message. String was: " + address);
        }

        var args = osc.readArguments(data, offsetState, withMetadata);
        if (args.length === 1) {
            args = args[0];
        }

        var message = {
            address: address,
            args: args
        };

        return message;
    };

    osc.makeDataView = function (data) {
        if (data instanceof DataView) {
            return data;
        }

        if (data.buffer) {
            return new DataView(data.buffer);
        }

        if (data instanceof ArrayBuffer) {
            return new DataView(data);
        }

        return new DataView(new Uint8Array(data));
    };

    osc.argumentReaders = {
        i: "readInt32",
        f: "readFloat32",
        s: "readString",
        b: "readBlob",
        T: "readTrue",
        F: "readFalse",
        N: "readNull",
        I: "readImpulse",
        S: "readString",
        t: "readTimeTag"

        // Missing optional OSC 1.0 types:
        // h: "readInt64",
        // d: "readFloat64",
        // c: "readChar32",
        // r: "readColor",
        // m: "readMIDI"
    };

    // If we're in a require-compatible environment, export ourselves.
    if (typeof module !== "undefined" && module.exports) {

        // Check if we're in Node.js and override makeDataView to support
        // native Node.js Buffers using the buffer-dataview library.
        if (typeof Buffer !== "undefined") {
            var BufferDataView = require("buffer-dataview");
            osc.makeDataView = function (data) {
                if (data instanceof DataView || data instanceof BufferDataView) {
                    return data;
                }

                if (data instanceof Buffer) {
                    return new BufferDataView(data);
                }

                if (data.buffer) {
                    return new DataView(data.buffer);
                }

                if (data instanceof ArrayBuffer) {
                    return new DataView(data);
                }

                return new DataView(new Uint8Array(data));
            };
        }

        module.exports = osc;
    }

}());
