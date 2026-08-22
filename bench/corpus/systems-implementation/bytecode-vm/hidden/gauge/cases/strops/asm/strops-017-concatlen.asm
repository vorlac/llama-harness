; case strops-017-concatlen
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_STR "0"
  PUSH_STR "0"
  CONCAT
  LEN
  PRINT
  RET
.end
