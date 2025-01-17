package relwarc

import (
	"bytes"
	"io"
	"os"
)

func determineLength(r io.Reader) (io.Reader, int64, error) {
	switch v := r.(type) {
	case *os.File:
		stat, err := v.Stat()
		if err != nil {
			return nil, 0, err
		}
		if stat.Mode().IsRegular() {
			size := stat.Size()
			return r, size, nil
		}
		// TODO: maybe support io.Seeker?
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, 0, err
	}
	return bytes.NewReader(data), int64(len(data)), nil
}
