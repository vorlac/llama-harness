; case strops-014-concatlen
; expect exit=0 stdout="12\n"
.func main arity=0 locals=0
  PUSH_STR "hello, "
  PUSH_STR "world"
  CONCAT
  LEN
  PRINT
  RET
.end
