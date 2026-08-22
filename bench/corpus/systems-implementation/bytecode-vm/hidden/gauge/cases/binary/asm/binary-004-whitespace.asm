; case binary-004-whitespace
; expect exit=0 stdout=""


; leading comment

.func main arity=0 locals=0    ; trailing comment
	 PUSH_STR "hello, svm"
  PRINT

  PUSH_INT 6
  PUSH_INT 7 ; another
  MUL
  PRINT
  RET
.end

