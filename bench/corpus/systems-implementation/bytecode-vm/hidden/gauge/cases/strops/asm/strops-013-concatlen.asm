; case strops-013-concatlen
; expect exit=0 stdout="4\n"
.func main arity=0 locals=0
  PUSH_STR "ab"
  PUSH_STR "cd"
  CONCAT
  LEN
  PRINT
  RET
.end
