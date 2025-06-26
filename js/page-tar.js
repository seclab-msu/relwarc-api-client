const pathlib = require('path');
const puppeteer = require('puppeteer');
const tar = require('tar-stream');

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const TIMED_OUT = new Error('Timed out');

function log(...args) {
    console.error((new Date()).toISOString(), 'page tar:', ...args);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function withTimeout(p, timeout) {
    let timeoutId;
    const timeoutPromise = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve(), timeout);
    });
    return Promise.race([p, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
}

function canonicalizeHeaderName(name) {
    return name.split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('-');
}

async function responseInfo(resp, req) {
    let url = resp.url();
    if (!["http:", "https:"].includes(new URL(url).protocol)) {
        return null;
    }
    const redirectChain = req.redirectChain();
    if (redirectChain.length > 0) {
        url = redirectChain[0].url();
    }
    const headers = {};

    const rawHeaders = resp.headers();
    for (const [key, value] of Object.entries(rawHeaders)) {
        headers[canonicalizeHeaderName(key)] = value.split('\n');
    }

    let body = null;
    try {
        body = await withTimeout(resp.buffer(), 4000);
    } catch (e) {
        return null;
    }

    if (!(body instanceof Buffer)) {
        return null;
    }

    const metainfo = {
        url,
        headers,
        type: req.resourceType()
    };
    return [metainfo, body];
}

function storeResource(resource, filename, tarPack, metainfo) {
    const [resourceMetainfo, body] = resource;
    metainfo[filename] = resourceMetainfo;
    return new Promise(resolve => {
        const entry = tarPack.entry({ name: filename, size: body.length }, resolve);
        entry.write(body);
        entry.end();
    });
}

function generateResourceFilenames() {
    let resID = 1;
    return function resourceFilename(url, mainHost, metainfo) {
        const parsedUrl = new URL(url);
        const path = parsedUrl.pathname;

        let name = path.replaceAll(/[^\w\s\-._]/g, '_');
        if (name[0] === '_') {
            name = name.substring(1);
        }
        const ext = pathlib.extname(name);
        if (name.length > 45) {
            name = name.substring(name.length - 45);
        }
        if (parsedUrl.host !== mainHost) {
            name = parsedUrl.host + '_' + name;
        }
        if (name in metainfo || name === 'index.html' || name === 'metainfo.json') {
            name = resID + ext;
            resID++;
        }
        return name;
    }
}

async function createTarUsingBrowser(url, tarPack, browser) {
    let mainPage = null;
    let associatedResources = [];
    let pageLoadComplete = false;

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    page.on('response', async (resp) => {
        if (pageLoadComplete || resp.frame() !== page.mainFrame()) {
            return;
        }
        const req = resp.request()
        const url = resp.url();
        log('got resp to', url);
        const respInfo = await responseInfo(resp, req);
        if (respInfo === null) {
            return;
        }
        if (req.resourceType() === 'document') {
            mainPage = respInfo;
            associatedResources = [];
        } else {
            associatedResources.push(respInfo);
        }
    });
    try {
        await page.goto(url, { waitUntil: 'load', timeout: 40000 });
    } catch (e) {
        if (!(e instanceof puppeteer.TimeoutError)) {
            throw e;
        }
        log('waiting for page load timed out');
    }
    log('load event arrived');
    await sleep(1000);
    const waitResult = await withTimeout(page.waitForNetworkIdle(), 10000);
    if (waitResult === TIMED_OUT) {
        log('waiting for network idle timed out');
    }
    pageLoadComplete = true;
    log('load complete');

    if (mainPage === null) {
        throw new Error('Failed to get page response');
    }

    const metainfo = Object.create(null);
    const resourcesPacked = [];
    const mainHost = new URL(mainPage[0].url).host;

    let p = storeResource(mainPage, 'index.html', tarPack, metainfo);
    resourcesPacked.push(p);

    const resourceFilename = generateResourceFilenames();

    for (const resource of associatedResources) {
        const filename = resourceFilename(resource[0].url, mainHost, metainfo);
        p = storeResource(resource, filename, tarPack, metainfo);
        resourcesPacked.push(p);
    }

    const metainfoJSON = JSON.stringify(metainfo);
    p = new Promise(r => {
        const e = tarPack.entry({ name: 'metainfo.json', size: metainfoJSON.length }, r);
        e.write(metainfoJSON);
        e.end();
    });
    resourcesPacked.push(p);
    await Promise.all(resourcesPacked);
    log('resources packed');
}

async function createPageTar(url, outputStream) {
    const browser = await puppeteer.launch({
        acceptInsecureCerts: true,
        args: [
            '--disable-features=HttpsUpgrades',
            '--disable-features=HttpsFirstBalancedMode',
            '--disable-features=HttpsFirstBalancedModeAutoEnable'
        ]
    });

    const tarPack = tar.pack();
    tarPack.pipe(outputStream);

    try {
        await createTarUsingBrowser(url, tarPack, browser);
    } finally {
        tarPack.finalize();
        await browser.close();
    }
}

exports.createPageTar = createPageTar;
