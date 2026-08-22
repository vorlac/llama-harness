; case strops-010-concatlen
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR ""
  CONCAT
  LEN
  PRINT
  RET
.end
