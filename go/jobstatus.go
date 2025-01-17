package relwarc

import (
	"encoding/json"
)

type AnalysisResult = json.RawMessage

type JobStatusMsg struct {
	Type    string         `json:"type"`
	Message string         `json:"message"`
	Result  AnalysisResult `json:"result"`
}
