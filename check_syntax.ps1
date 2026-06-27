# Check basic brace balance in the edited section of AppLayout.tsx
$file = "c:\Users\Jarno\repo\agilefant-squared-6b8cedbf\src\components\WorkItemTreePanel.tsx"
$lines = Get-Content $file
$depth = 0
$inHandler = $false
for ($i = 0; $i -lt $lines.Length; $i++) {
    $l = $lines[$i]
    if ($l -match "if \(e\.key !== .Tab.\) return") { 
        $inHandler = $true
        $depth = 0
        Write-Host "--- Tab handler starts at line $($i+1) ---"
    }
    if ($inHandler) {
        $open = ($l.ToCharArray() | Where-Object { $_ -eq '{' } | Measure-Object).Count
        $close = ($l.ToCharArray() | Where-Object { $_ -eq '}' } | Measure-Object).Count
        $depth += $open - $close
    }
    if ($inHandler -and $l -match "^\s*\};" -and $depth -le 1) {
        Write-Host "$($i+1): depth=$depth | $l"
        if ($depth -eq 0) {
            $inHandler = $false
            Write-Host "--- Tab handler ends at line $($i+1), final depth=$depth (0=OK) ---"
        }
    }
    if ($inHandler -and ($depth -ne 0 -or $l -match '^\s*\};')) {
        Write-Host "$($i+1): depth=$depth | $l"
    }
}
Write-Host "Final depth: $depth"

