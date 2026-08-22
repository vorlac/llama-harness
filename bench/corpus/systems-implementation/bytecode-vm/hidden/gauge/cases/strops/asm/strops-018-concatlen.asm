; case strops-018-concatlen
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_STR "\\"
  PUSH_STR "\""
  CONCAT
  LEN
  PRINT
  RET
.end
