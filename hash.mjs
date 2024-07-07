const baseToShifted = {
    '0': 'A', '1': 'B', '2': 'C', '3': 'D',
    '4': 'E', '5': 'F', '6': 'G', '7': 'H',
    '8': 'I', '9': 'J', 'a': 'K', 'b': 'L',
    'c': 'M', 'd': 'N', 'e': 'O', 'f': 'P',
    'g': 'Q', 'h': 'R', 'i': 'S', 'j': 'T',
    'k': 'U', 'l': 'V', 'm': 'W', 'n': 'X',
    'o': 'Y', 'p': 'Z', 'q': 'q', 'r': 'r',
    's': 's', 't': 't', 'u': 'u', 'v': 'v',
    'w': 'w', 'x': 'x', 'y': 'y', 'z': 'z'
};

const base = Object.keys(baseToShifted).length;

function shifString(baseString) {
    let shiftedString = '';
    for (let i = 0; i < baseString.length; i++) {
        shiftedString += baseToShifted[baseString[i]];
    }
    return shiftedString;
}


function hash(inputString) {
    if (inputString.match(/^\$C0=.*;$/))
        inputString = inputString.slice(4,-1);
    let hashValue = 0;
    const prime = 31;
    const mod = 9007199254740881;

    for (let i = 0; i < inputString.length; i++) {
        let charCode = inputString.charCodeAt(i);
        hashValue = (hashValue * prime + charCode) % mod;
    }

    return shifString(hashValue.toString(base));
}

export default hash;
export { hash };
