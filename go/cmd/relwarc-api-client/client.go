package main

import (
	"fmt"
	"os"
	//"strings"

	"github.com/spf13/cobra"

	client "relwarc-api-client"
)

func main() {
	var (
		serverAddr  string
		apiToken    string
		relwarc     *client.RelwarcAPIClient
		analysisErr error
	)

	rootCmd := &cobra.Command{
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			var err error

			relwarc, err = client.NewRelwarcAPIClientForServer(apiToken, serverAddr)
			return err
		},
		Use: "relwarc-api-client",
	}
	rootCmd.PersistentFlags().StringVar(
		&serverAddr,
		"server-addr",
		client.DefaultServerAddr,
		"Relwarc API server address",
	)
	rootCmd.PersistentFlags().StringVar(&apiToken, "api-token", "", "Relwarc API token")

	analyzeSourceFileCmd := &cobra.Command{
		Use:  "analyze-source-file",
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			fname := args[0]
			f, err := os.Open(fname)
			if err != nil {
				analysisErr = fmt.Errorf("Error opening file %q: %w", fname, err)
				return
			}
			result, err := relwarc.AnalyzeSourceCode(f)
			if err != nil {
				analysisErr = err
				return
			}
			_, analysisErr = os.Stdout.Write(result)
		},
	}
	analyzeURLCmd := &cobra.Command{
		Use:  "analyze-url",
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			u := args[0]
			result, err := relwarc.AnalyzePageURL(u)
			if err != nil {
				analysisErr = err
				return
			}
			_, analysisErr = os.Stdout.Write(result)
		},
	}
	analyzeTARCmd := &cobra.Command{
		Use:  "analyze-tar",
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			fname := args[0]
			f, err := os.Open(fname)
			if err != nil {
				analysisErr = fmt.Errorf("Error opening tar file %q: %w", fname, err)
				return
			}
			result, err := relwarc.AnalyzePageTAR(f)
			if err != nil {
				analysisErr = err
				return
			}
			_, analysisErr = os.Stdout.Write(result)
		},
	}
	rootCmd.AddCommand(analyzeSourceFileCmd)
	rootCmd.AddCommand(analyzeURLCmd)
	rootCmd.AddCommand(analyzeTARCmd)

	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
	if analysisErr != nil {
		fmt.Fprintf(os.Stderr, "Error: %v", analysisErr)
		os.Exit(1)
	}
}
