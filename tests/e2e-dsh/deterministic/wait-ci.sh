# stdin is one JSON context; never send diagnostic output to stdout.
context=$(node -e 'let text="";process.stdin.on("data",chunk=>text+=chunk);process.stdin.on("end",()=>{const input=JSON.parse(text);process.stdout.write(String(Date.parse(input.startedAt))+" "+(input.params?.pipeline??""));});') || exit 3
read -r started pipeline <<EOF
$context
EOF
[ "$pipeline" = "local-ci" ] || { printf '%s\n' 'Missing the declared pipeline parameter.' >&2; exit 3; }
while [ "$(node -e 'process.stdout.write(String(Date.now()))')" -lt "$((started + 60000))" ]; do
  node fake-ci.cjs
  status=$?
  case "$status" in
    0) printf '%s\n' '{"exit":"passed","message":"Local CI passed."}'; exit 0 ;;
    1) printf '%s\n' '{"exit":"rejected","message":"Local CI rejected the change."}'; exit 0 ;;
    2) sleep 0.02 ;;
    *) printf '%s\n' 'Local CI checker failed.' >&2; exit 3 ;;
  esac
done
printf '%s\n' 'Local CI business deadline expired.' >&2
exit 3
