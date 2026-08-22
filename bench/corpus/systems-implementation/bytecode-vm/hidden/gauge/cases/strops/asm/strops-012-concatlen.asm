; case strops-012-concatlen
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR "a"
  CONCAT
  LEN
  PRINT
  RET
.end
