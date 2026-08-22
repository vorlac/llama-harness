; case strops-011-concatlen
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR ""
  CONCAT
  LEN
  PRINT
  RET
.end
