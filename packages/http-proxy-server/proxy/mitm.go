package proxy

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// CA holds an in-memory certificate authority for MITM proxying.
type CA struct {
	cert    *x509.Certificate
	key     *ecdsa.PrivateKey
	certPEM []byte
	certDER []byte

	// Cache of generated leaf certificates keyed by hostname
	leafCache sync.Map // map[string]*tls.Certificate
}

// NewCA generates a new ECDSA P-256 CA certificate and key pair.
func NewCA() (*CA, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generating CA key: %w", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("generating serial: %w", err)
	}

	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			Organization: []string{"Vercel"},
			CommonName:   "Vercel Sandbox Proxy CA",
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("creating CA certificate: %w", err)
	}

	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return nil, fmt.Errorf("parsing CA certificate: %w", err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

	return &CA{
		cert:    cert,
		key:     key,
		certPEM: certPEM,
		certDER: certDER,
	}, nil
}

// CertPEM returns the PEM-encoded CA certificate for installation in trust stores.
func (ca *CA) CertPEM() []byte {
	return ca.certPEM
}

// TLSConfigForHost returns a *tls.Config that presents a leaf certificate
// for the given hostname, signed by this CA. Leaf certs are cached.
func (ca *CA) TLSConfigForHost(hostname string) (*tls.Config, error) {
	leaf, err := ca.leafCert(hostname)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{*leaf},
	}, nil
}

func (ca *CA) leafCert(hostname string) (*tls.Certificate, error) {
	if cached, ok := ca.leafCache.Load(hostname); ok {
		return cached.(*tls.Certificate), nil
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generating leaf key: %w", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("generating serial: %w", err)
	}

	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			Organization: []string{"Vercel Sandbox Proxy"},
			CommonName:   hostname,
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  time.Now().Add(24 * time.Hour),
		KeyUsage:  x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageServerAuth,
		},
		DNSNames: []string{hostname},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		return nil, fmt.Errorf("creating leaf certificate: %w", err)
	}

	leaf := &tls.Certificate{
		Certificate: [][]byte{certDER, ca.certDER},
		PrivateKey:  key,
	}

	ca.leafCache.Store(hostname, leaf)
	return leaf, nil
}
