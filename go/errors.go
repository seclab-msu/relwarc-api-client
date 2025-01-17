package relwarc

import (
	"fmt"
)

type RelwarcAPIError struct {
	EndpointURL  string
	Status       int
	ErrorMessage string
}

func (e *RelwarcAPIError) Error() string {
	return fmt.Sprintf(
		"Relwarc API endpoint %s responded with status %d: %s",
		e.EndpointURL,
		e.Status,
		e.ErrorMessage,
	)
}

type RelwarcJobError struct {
	JobID        uint64
	ErrorMessage string
}

func (e *RelwarcJobError) Error() string {
	return fmt.Sprintf(
		"Relwarc failed to execute job %d, error msg is: %s",
		e.JobID,
		e.ErrorMessage,
	)
}
