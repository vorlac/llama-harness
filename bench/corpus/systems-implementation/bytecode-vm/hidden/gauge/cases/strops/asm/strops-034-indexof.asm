; case strops-034-indexof
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "l"
  INDEXOF
  PRINT
  RET
.end
