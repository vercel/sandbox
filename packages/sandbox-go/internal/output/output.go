package output

import (
	"fmt"
	"io"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"
)

func Table(writer io.Writer, headers []string, rows [][]string) {
	table := tabwriter.NewWriter(writer, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(table, strings.Join(headers, "\t"))
	for _, row := range rows {
		_, _ = fmt.Fprintln(table, strings.Join(row, "\t"))
	}
	_ = table.Flush()
}

func TimeAgo(milliseconds int64) string {
	if milliseconds == 0 {
		return "-"
	}
	delta := time.Since(time.UnixMilli(milliseconds))
	future := delta < 0
	if future {
		delta = -delta
	}
	var value string
	switch {
	case delta < time.Minute:
		value = fmt.Sprintf("%ds", int(delta.Seconds()))
	case delta < time.Hour:
		value = fmt.Sprintf("%dm", int(delta.Minutes()))
	case delta < 24*time.Hour:
		value = fmt.Sprintf("%dh", int(delta.Hours()))
	default:
		value = fmt.Sprintf("%dd", int(delta.Hours()/24))
	}
	if future {
		return "in " + value
	}
	return value + " ago"
}

func Number(value float64) string {
	if value == 0 {
		return "-"
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func Bytes(value int64) string {
	const unit = 1024
	if value < unit {
		return fmt.Sprintf("%d B", value)
	}
	div, exp := int64(unit), 0
	for n := value / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(value)/float64(div), "KMGTPE"[exp])
}
