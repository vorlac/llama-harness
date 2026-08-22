; case strops-035-indexof
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "lo"
  INDEXOF
  PRINT
  RET
.end
