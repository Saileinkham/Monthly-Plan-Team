
lines = []
with open('index.html', 'r') as f:
    lines = f.readlines()

new_lines = []
# Header part
new_lines.extend(lines[0:8])

# CSS Link
new_lines.append('    <link rel="stylesheet" href="style.css">\n')

# Body part (between style and script)
# Skip lines 8 to 2975 (inclusive indices for <style>...</style>)
# We want to start after </style>, which is line 2976 (index 2975). So start at index 2976.
# Stop before <script>, which is line 4072 (index 4071).
new_lines.extend(lines[2976:4071])

# JS Link
new_lines.append('    <script src="script.js"></script>\n')

# Footer part
# Skip lines 4071 to 7869 (inclusive indices for <script>...</script>)
# We want to start after </script>, which is line 7870 (index 7869). So start at index 7870.
new_lines.extend(lines[7870:])

with open('index.html', 'w') as f:
    f.writelines(new_lines)
