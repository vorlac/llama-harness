; case strops-046-len
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  LEN
  PRINT
  RET
.end
