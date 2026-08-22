; case strops-047-len
; expect exit=0 stdout="11\n"
.func main arity=0 locals=0
  PUSH_STR "hello world"
  LEN
  PRINT
  RET
.end
