"use strict";
exports.__esModule = true;
exports.sha256 = void 0;
function m(e, t) {
    var n = (65535 & e) + (65535 & t);
    return (e >> 16) + (t >> 16) + (n >> 16) << 16 | 65535 & n;
}
function C(e, t) {
    return e >>> t | e << 32 - t;
}
function fun0(e) {
    var t = '';
    for (var n = 0; n < 4 * e.length; n++) {
        t += '0123456789abcdef'.charAt(e[n >> 2] >> 8 * (3 - n % 4) + 4 & 15) +
            '0123456789abcdef'.charAt(e[n >> 2] >> 8 * (3 - n % 4) & 15);
    }
    return t;
}
function fun1(e, t) {
    var n;
    var r;
    var s;
    var o;
    var i;
    var a;
    var u;
    var c;
    var l;
    var d;
    var p;
    var P;
    var h = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080,
        310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774,
        264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808,
        3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291,
        1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817,
        3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063,
        1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298];
    var f = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
    var I = Array(64);
    for (e[t >> 5] |= 128 << 24 - t % 32, e[15 + (t + 64 >> 9 << 4)] = t, l = 0; l < e.length; l += 16) {
        for (n = f[0], r = f[1], s = f[2], o = f[3], i = f[4], a = f[5], u = f[6], c = f[7], d = 0; d < 64; d++) {
            I[d] = d < 16 ? e[d + l] : m(m(m(C(I[d - 2], 17) ^ C(I[d - 2], 19) ^ I[d - 2] >>> 10, I[d - 7]), C(I[d - 15], 7) ^ C(I[d - 15], 18) ^ I[d - 15] >>> 3), I[d - 16]);
            p = m(m(m(m(c, C(i, 6) ^ C(i, 11) ^ C(i, 25)), i & a ^ ~i & u), h[d]), I[d]);
            P = m(C(n, 2) ^ C(n, 13) ^ C(n, 22), n & r ^ n & s ^ r & s);
            c = u;
            u = a;
            a = i;
            i = m(o, p);
            o = s;
            s = r;
            r = n;
            n = m(p, P);
        }
        f[0] = m(n, f[0]);
        f[1] = m(r, f[1]);
        f[2] = m(s, f[2]);
        f[3] = m(o, f[3]);
        f[4] = m(i, f[4]);
        f[5] = m(a, f[5]);
        f[6] = m(u, f[6]);
        f[7] = m(c, f[7]);
    }
    return f;
}
function fun2(e) {
    var t = [];
    for (var n = 0; n < 8 * e.length; n += 8) {
        t[n >> 5] |= (255 & e.charCodeAt(n / 8)) << 24 - n % 32;
    }
    return t;
}
function fun3(e) {
    e = e.replace(/\r\n/g, '\n');
    var t = '';
    for (var n = 0; n < e.length; n++) {
        var r = e.charCodeAt(n);
        if (r < 128) {
            t += String.fromCharCode(r);
        }
        else {
            if (r > 127 && r < 2048) {
                t += String.fromCharCode(r >> 6 | 192);
            }
            else {
                t += String.fromCharCode(r >> 12 | 224);
                t += String.fromCharCode(r >> 6 & 63 | 128);
            }
            t += String.fromCharCode(63 & r | 128);
        }
    }
    return t;
}
function sha256(e) {
    var a0 = fun1(fun2(e = (fun3(e))), 8 * e.length);
    return fun0(a0);
}
exports.sha256 = sha256;
