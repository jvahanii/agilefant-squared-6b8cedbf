$f = 'c:\Users\Jarno\repo\agilefant-squared-6b8cedbf\src\components\AppLayout.tsx'
$c = [System.IO.File]::ReadAllText($f)
$nl = "`r`n"

# Fix: change `} else if` at 12 spaces back to `}` + `} else if` at 10 spaces in arrow case
$old = "            } else if (state.selectedBacklogIds.length > 0) {$nl            // Navigate selection through visible backlogs."
$new = "            }$nl          } else if (state.selectedBacklogIds.length > 0) {$nl            // Navigate selection through visible backlogs."

if ($c.Contains($old)) {
    $c = $c.Replace($old, $new)
    [System.IO.File]::WriteAllText($f, $c)
    Write-Output "FIXED arrow case"
} else {
    Write-Output "Pattern NOT found"
}

# Also check if the old bad pattern exists at line 536 (just in case there's a second occurrence)
$count = ([regex]::Matches($c, '} else if \(state\.selectedBacklogIds\.length > 0\) \{')).Count
Write-Output "Total occurrences of pattern: $count"
