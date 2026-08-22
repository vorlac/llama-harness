; case strops-015-concatlen
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_STR "\n"
  PUSH_STR "\t"
  CONCAT
  LEN
  PRINT
  RET
.end
