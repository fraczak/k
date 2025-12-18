import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import codes from '../codes.mjs';
import { parse } from './typeParser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = path.join(__dirname, 'registry.json');
const PORT = 3001;

// Load existing registry if it exists
if (fs.existsSync(REGISTRY_FILE)) {
    console.log('Loading existing registry...');
    try {
        const data = fs.readFileSync(REGISTRY_FILE, 'utf8');
        const json = JSON.parse(data);
        codes.load(json);
        console.log(`Loaded ${Object.keys(json).length} types.`);
    } catch (err) {
        console.error('Error loading registry:', err);
    }
} else {
    console.log('No existing registry found. Starting fresh.');
}


const getClosure = (name) => {
    const dict = {};
    let q = [name];
    while (q.length > 0) {
    	let x = q.shift();
	if (! dict[x] ) {
	   dict[x] = codes.find(x);
	   q = q.concat(Object.values(dict[x][dict[x].code]));
	}
    }
    return dict;
};


const server = http.createServer((req, res) => {
    // Helper to send JSON response
    const sendJSON = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };

    // Helper to send Error
    const sendError = (message, status = 400) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
    };

    // Route: POST
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                // 1. Parse the input string using the Jison parser
                // The parser expects a string of type definitions
                console.log("Received body:", body);
                const definitions = parse(body);
                console.log("Parsed definitions:", JSON.stringify(definitions, null, 2));

                // 2. Register the parsed codes
                // codes.register returns the representatives map { temp_name: canonical_hash }
                const representatives = codes.register(definitions);

                // Filter out generated names (_gen_...) and canonical names (@...)
                const filteredRepresentatives = Object.fromEntries(
                    Object.entries(representatives).filter(([key, value]) => 
                        !key.startsWith(':') && !key.startsWith('@')
                    )
                );

                // 3. Save to disk
                const dump = codes.dump();
                fs.writeFileSync(REGISTRY_FILE, JSON.stringify(dump, null, 2));

                // 4. Return the mapping
                sendJSON(filteredRepresentatives);

            } catch (err) {
                console.error(err);
                sendError(`Registration failed: ${err.message}`);
            }
        });
    }
    // Route: GET 
    else if (req.method === 'GET') {
        const typeId = req.url.split('/').pop();
        console.log("Requested type ID:", typeId);
        if (!typeId) {
            sendError('Missing type ID');
            return;
        }
        // Decode URI component in case @ is encoded
        const decodedId = decodeURIComponent(typeId);
        console.log("Decoded type ID:", decodedId);
        
        const typeDef = codes.find(decodedId);
        if (typeDef.code === 'undefined') {
            sendError('Type not found', 404);
        } else if (req.url.startsWith("/all/")) {
            sendJSON(getClosure(decodedId));
	} else {
	    sendJSON(typeDef);
        }
    }
    // 404 Not Found
    else {
        sendError('Not Found', 404);
    }
});

server.listen(PORT, () => {
    console.log(`Type Registry running at http://localhost:${PORT}/`);
});
