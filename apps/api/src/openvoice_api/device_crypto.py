"""Server-side verification of device-key proofs (ADR-0008).

The server never holds private keys and performs no custom cryptography: it
uses pyca/cryptography (the standard, maintained Python crypto library) to
verify ECDSA P-256 signatures produced by the browser's non-extractable device
key (Web Crypto). This turns device registration from an unauthenticated claim
("here is a public key") into a proof of possession ("I hold the private key
for this public key"), and lets a session be bound to a proven device.

Wire formats (must match apps/web/src/crypto/device.ts):
  - public key: base64 of the SPKI DER encoding (Web Crypto exportKey("spki"))
  - signature:  base64 of the raw IEEE-P1363 r||s pair (Web Crypto sign()),
    which we convert to DER for verification.
"""

from __future__ import annotations

import base64
import binascii

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

_P256_COORD_BYTES = 32
_RAW_SIG_BYTES = _P256_COORD_BYTES * 2


def verify_device_signature(
    public_key_spki_b64: str, message: bytes, signature_raw_b64: str
) -> bool:
    """True iff `signature_raw_b64` is a valid ECDSA-P256/SHA-256 signature of
    `message` under the SPKI public key `public_key_spki_b64`. Never raises —
    any malformed input is a verification failure, not an error."""
    try:
        spki_der = base64.b64decode(public_key_spki_b64, validate=True)
        public_key = serialization.load_der_public_key(spki_der)
    except (binascii.Error, ValueError, TypeError):
        return False
    if not isinstance(public_key, ec.EllipticCurvePublicKey) or not isinstance(
        public_key.curve, ec.SECP256R1
    ):
        return False
    try:
        raw = base64.b64decode(signature_raw_b64, validate=True)
    except (binascii.Error, ValueError, TypeError):
        return False
    if len(raw) != _RAW_SIG_BYTES:
        return False
    r = int.from_bytes(raw[:_P256_COORD_BYTES], "big")
    s = int.from_bytes(raw[_P256_COORD_BYTES:], "big")
    der_sig = encode_dss_signature(r, s)
    try:
        public_key.verify(der_sig, message, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        return False
    return True
